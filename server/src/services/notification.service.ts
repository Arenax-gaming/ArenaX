import fetch from 'node-fetch';
import { getDatabaseClient } from './database.service';

const WEBHOOK_URL = process.env.ADMIN_WEBHOOK_URL;

export type NotificationType =
  | 'match_started'
  | 'match_ended'
  | 'achievement_unlocked'
  | 'payment_received'
  | 'friend_request'
  | 'tournament_started'
  | 'tournament-start'
  | 'dispute_resolved'
  | 'system_alert'
  | string;

export type NotificationChannel = 'email' | 'push' | 'in-app';

export interface Notification {
  id: string
  userId: string
  type: NotificationType
  title: string
  content: string
  read: boolean
  createdAt: Date
  readAt?: Date
  sentChannels?: string[]
  skippedChannels?: string[]
}

export interface NotificationPreferences {
  userId: string
  inAppNotifications: boolean
  emailNotifications: boolean
  pushNotifications: boolean
  notificationTypes: Partial<Record<string, boolean>>
}

export interface NotificationPreferenceRecord {
  id?: string
  userId: string
  eventType: string
  channel: string
  enabled: boolean
  createdAt?: Date
  updatedAt?: Date
}

export interface NotificationFilter {
  type?: NotificationType
  read?: boolean
  limit?: number
  offset?: number
}

export const DEFAULT_EVENT_TYPES = [
  'tournament_started',
  'tournament-start',
  'match_started',
  'match_ended',
  'achievement_unlocked',
  'payment_received',
  'friend_request',
  'dispute_resolved',
  'system_alert',
];

export const DEFAULT_CHANNELS: NotificationChannel[] = ['email', 'push', 'in-app'];

export class NotificationService {
  static async notifyWebhook(event: { type: string; payload: any }) {
    if (!WEBHOOK_URL) {
      console.log('[Notification] no webhook configured; skipping notification', event.type);
      return false;
    }

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: event.type, payload: event.payload, timestamp: new Date().toISOString() })
      });

      if (!res.ok) {
        console.warn('[Notification] webhook responded with', res.status);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[Notification] webhook failed', err);
      return false;
    }
  }

  private notifications = new Map<string, Notification[]>()
  private preferences = new Map<string, NotificationPreferences>()
  private perEventPreferences = new Map<string, Map<string, boolean>>()
  private messageQueue: Notification[] = []
  public pushDispatches: { userId: string; notification: Notification }[] = []
  public emailDispatches: { userId: string; notification: Notification }[] = []
  public inAppDispatches: { userId: string; notification: Notification }[] = []

  private getPrefKey(eventType: string, channel: string): string {
    return `${eventType.trim().toLowerCase()}:${channel.trim().toLowerCase()}`;
  }

  /**
   * Normalizes event types for preference checks (e.g., tournament-start <-> tournament_started)
   */
  private getEventAliases(eventType: string): string[] {
    const raw = eventType.trim().toLowerCase();
    const snake = raw.replace(/-/g, '_');
    const kebab = raw.replace(/_/g, '-');
    return Array.from(new Set([raw, snake, kebab]));
  }

  /**
   * Check if a specific channel is enabled for a given user and event type.
   */
  async isChannelEnabled(userId: string, eventType: string, channel: NotificationChannel): Promise<boolean> {
    const channelKey = channel.toLowerCase();

    // 1. Check in-memory per-event preferences first
    const userPrefs = this.perEventPreferences.get(userId);
    if (userPrefs) {
      for (const alias of this.getEventAliases(eventType)) {
        const key = this.getPrefKey(alias, channelKey);
        if (userPrefs.has(key)) {
          return userPrefs.get(key)!;
        }
      }
    }

    // 2. Check Database if available
    try {
      const prisma = getDatabaseClient();
      if ((prisma as any).notificationPreference) {
        const aliases = this.getEventAliases(eventType);
        const record = await (prisma as any).notificationPreference.findFirst({
          where: {
            userId,
            eventType: { in: aliases },
            channel: channelKey,
          },
        });
        if (record) {
          // Cache in memory
          if (!this.perEventPreferences.has(userId)) {
            this.perEventPreferences.set(userId, new Map());
          }
          this.perEventPreferences.get(userId)!.set(this.getPrefKey(record.eventType, channelKey), record.enabled);
          return record.enabled;
        }
      }
    } catch {
      // Fallback silently if DB is unavailable
    }

    // 3. Fallback to broad channel preferences
    const globalPrefs = this.preferences.get(userId) || this.getDefaultPreferences(userId);
    if (channel === 'in-app' && !globalPrefs.inAppNotifications) return false;
    if (channel === 'email' && !globalPrefs.emailNotifications) return false;
    if (channel === 'push' && !globalPrefs.pushNotifications) return false;

    // Default to true
    return true;
  }

  /**
   * Creates a default preference set for a newly registered user.
   */
  async createDefaultPreferences(userId: string): Promise<NotificationPreferenceRecord[]> {
    const defaultRecords: NotificationPreferenceRecord[] = [];

    if (!this.perEventPreferences.has(userId)) {
      this.perEventPreferences.set(userId, new Map());
    }
    const userMap = this.perEventPreferences.get(userId)!;

    for (const eventType of DEFAULT_EVENT_TYPES) {
      for (const channel of DEFAULT_CHANNELS) {
        userMap.set(this.getPrefKey(eventType, channel), true);
        defaultRecords.push({
          userId,
          eventType,
          channel,
          enabled: true,
        });
      }
    }

    // Persist to database if available
    try {
      const prisma = getDatabaseClient();
      if ((prisma as any).notificationPreference) {
        for (const record of defaultRecords) {
          await (prisma as any).notificationPreference.upsert({
            where: {
              userId_eventType_channel: {
                userId: record.userId,
                eventType: record.eventType,
                channel: record.channel,
              },
            },
            update: { enabled: record.enabled },
            create: {
              userId: record.userId,
              eventType: record.eventType,
              channel: record.channel,
              enabled: record.enabled,
            },
          });
        }
      }
    } catch {
      // Fallback silently if DB is unavailable
    }

    this.preferences.set(userId, this.getDefaultPreferences(userId));
    return defaultRecords;
  }

  /**
   * Sets or updates a per-event channel preference.
   */
  async setPreference(
    userId: string,
    eventType: string,
    channel: string,
    enabled: boolean
  ): Promise<NotificationPreferenceRecord> {
    const normalizedChannel = channel.toLowerCase();
    const key = this.getPrefKey(eventType, normalizedChannel);

    if (!this.perEventPreferences.has(userId)) {
      this.perEventPreferences.set(userId, new Map());
    }
    this.perEventPreferences.get(userId)!.set(key, enabled);

    // Also set for common aliases so 'tournament-start' and 'tournament_started' remain in sync
    for (const alias of this.getEventAliases(eventType)) {
      this.perEventPreferences.get(userId)!.set(this.getPrefKey(alias, normalizedChannel), enabled);
    }

    let record: NotificationPreferenceRecord = {
      userId,
      eventType,
      channel: normalizedChannel,
      enabled,
      updatedAt: new Date(),
    };

    try {
      const prisma = getDatabaseClient();
      if ((prisma as any).notificationPreference) {
        record = await (prisma as any).notificationPreference.upsert({
          where: {
            userId_eventType_channel: {
              userId,
              eventType,
              channel: normalizedChannel,
            },
          },
          update: { enabled },
          create: {
            userId,
            eventType,
            channel: normalizedChannel,
            enabled,
          },
        });
      }
    } catch {
      // In-memory fallback
    }

    return record;
  }

  /**
   * Get all per-event preferences for a user.
   */
  async getPerEventPreferences(userId: string): Promise<NotificationPreferenceRecord[]> {
    try {
      const prisma = getDatabaseClient();
      if ((prisma as any).notificationPreference) {
        const records = await (prisma as any).notificationPreference.findMany({
          where: { userId },
        });
        if (records && records.length > 0) {
          return records;
        }
      }
    } catch {
      // fallback
    }

    // In-memory list
    const results: NotificationPreferenceRecord[] = [];
    const userMap = this.perEventPreferences.get(userId);
    if (userMap) {
      for (const [k, enabled] of userMap.entries()) {
        const [eventType, channel] = k.split(':');
        results.push({ userId, eventType, channel, enabled });
      }
    }

    if (results.length === 0) {
      return this.createDefaultPreferences(userId);
    }

    return results;
  }

  async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    content: string
  ): Promise<Notification> {
    const notification: Notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      type,
      title,
      content,
      read: false,
      createdAt: new Date(),
      sentChannels: [],
      skippedChannels: [],
    }

    // Store notification
    if (!this.notifications.has(userId)) {
      this.notifications.set(userId, [])
    }
    this.notifications.get(userId)!.push(notification)

    // Check user preferences before sending each channel
    const inAppEnabled = await this.isChannelEnabled(userId, type, 'in-app');
    if (inAppEnabled) {
      this.emitWebSocketEvent(userId, 'notification:new', notification);
      this.inAppDispatches.push({ userId, notification });
      notification.sentChannels!.push('in-app');
    } else {
      notification.skippedChannels!.push('in-app');
    }

    const emailEnabled = await this.isChannelEnabled(userId, type, 'email');
    if (emailEnabled) {
      await this.queueEmailNotification(userId, notification);
      this.emailDispatches.push({ userId, notification });
      notification.sentChannels!.push('email');
    } else {
      notification.skippedChannels!.push('email');
    }

    const pushEnabled = await this.isChannelEnabled(userId, type, 'push');
    if (pushEnabled) {
      await this.queuePushNotification(userId, notification);
      this.pushDispatches.push({ userId, notification });
      notification.sentChannels!.push('push');
    } else {
      notification.skippedChannels!.push('push');
    }

    console.log('[Notification] Processed for', userId, ':', {
      type,
      title,
      sent: notification.sentChannels,
      skipped: notification.skippedChannels,
    });

    return notification
  }

  async getNotifications(
    userId: string,
    filters: NotificationFilter = {}
  ): Promise<Notification[]> {
    const userNotifications = this.notifications.get(userId) || []
    const {
      type,
      read,
      limit = 50,
      offset = 0,
    } = filters

    let filtered = [...userNotifications]

    if (type) {
      filtered = filtered.filter(n => n.type === type)
    }

    if (read !== undefined) {
      filtered = filtered.filter(n => n.read === read)
    }

    // Return in reverse chronological order, paginated
    return filtered
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit)
  }

  async markAsRead(userId: string, notificationId: string): Promise<boolean> {
    const userNotifications = this.notifications.get(userId)
    if (!userNotifications) return false

    const notification = userNotifications.find(n => n.id === notificationId)
    if (!notification) return false

    notification.read = true
    notification.readAt = new Date()

    // Emit WebSocket event
    this.emitWebSocketEvent(userId, 'notification:read', { notificationId })

    console.log('[Notification] Marked as read:', notificationId)

    return true
  }

  async markAllAsRead(userId: string): Promise<number> {
    const userNotifications = this.notifications.get(userId) || []
    let count = 0

    for (const notification of userNotifications) {
      if (!notification.read) {
        notification.read = true
        notification.readAt = new Date()
        count++
      }
    }

    console.log('[Notification] Marked all as read for', userId, ':', count)

    return count
  }

  async deleteNotification(userId: string, notificationId: string): Promise<boolean> {
    const userNotifications = this.notifications.get(userId)
    if (!userNotifications) return false

    const index = userNotifications.findIndex(n => n.id === notificationId)
    if (index === -1) return false

    userNotifications.splice(index, 1)

    console.log('[Notification] Deleted:', notificationId)

    return true
  }

  async updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    const current = this.preferences.get(userId) || this.getDefaultPreferences(userId)
    const updated = { ...current, ...preferences, userId }

    this.preferences.set(userId, updated)

    console.log('[Notification] Preferences updated for', userId)

    return updated
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    return this.preferences.get(userId) || this.getDefaultPreferences(userId)
  }

  async batchSendNotifications(
    userIds: string[],
    type: NotificationType,
    title: string,
    content: string
  ): Promise<Notification[]> {
    const notifications: Notification[] = []

    for (const userId of userIds) {
      const notif = await this.sendNotification(userId, type, title, content)
      notifications.push(notif)
    }

    console.log('[Notification] Batch sent to', userIds.length, 'users')

    return notifications
  }

  private getDefaultPreferences(userId: string): NotificationPreferences {
    return {
      userId,
      inAppNotifications: true,
      emailNotifications: true,
      pushNotifications: true,
      notificationTypes: {
        match_started: true,
        match_ended: true,
        achievement_unlocked: true,
        payment_received: true,
        friend_request: true,
        tournament_started: true,
        'tournament-start': true,
        system_alert: true,
      },
    }
  }

  private emitWebSocketEvent(userId: string, event: string, data: any): void {
    console.log(`[WebSocket] ${event} for ${userId}:`, data)
  }

  public async queueEmailNotification(userId: string, notification: Notification): Promise<void> {
    console.log('[Email Queue] Notification for', userId, ':', notification.title)
  }

  public async queuePushNotification(userId: string, notification: Notification): Promise<void> {
    console.log('[Push Queue] Notification for', userId, ':', notification.title)
  }

  getUnreadCount(userId: string): number {
    const userNotifications = this.notifications.get(userId) || []
    return userNotifications.filter(n => !n.read).length
  }

  getNotificationStats(userId: string): {
    total: number
    unread: number
    byType: Record<string, number>
  } {
    const userNotifications = this.notifications.get(userId) || []

    const stats = {
      total: userNotifications.length,
      unread: userNotifications.filter(n => !n.read).length,
      byType: {} as Record<string, number>,
    }

    for (const notification of userNotifications) {
      stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1
    }

    return stats
  }
}

export const notificationService = new NotificationService();

export function createNotificationService() {
  return new NotificationService()
}
