export type NotificationType =
  | 'match_started'
  | 'match_ended'
  | 'achievement_unlocked'
  | 'payment_received'
  | 'friend_request'
  | 'tournament_started'
  | 'system_alert'

export interface Notification {
  id: string
  userId: string
  type: NotificationType
  title: string
  content: string
  read: boolean
  createdAt: Date
  readAt?: Date
}

export interface NotificationPreferences {
  userId: string
  inAppNotifications: boolean
  emailNotifications: boolean
  pushNotifications: boolean
  notificationTypes: Partial<Record<NotificationType, boolean>>
}

export interface NotificationFilter {
  type?: NotificationType
  read?: boolean
  limit?: number
  offset?: number
}

export class NotificationService {
  private notifications = new Map<string, Notification[]>()
  private preferences = new Map<string, NotificationPreferences>()
  private messageQueue: Notification[] = []

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
    }

    // Store notification
    if (!this.notifications.has(userId)) {
      this.notifications.set(userId, [])
    }
    this.notifications.get(userId)!.push(notification)

    // Check user preferences before sending
    const prefs = this.preferences.get(userId) || this.getDefaultPreferences(userId)

    if (prefs.inAppNotifications) {
      // In production, emit WebSocket event
      this.emitWebSocketEvent(userId, 'notification:new', notification)
    }

    if (prefs.emailNotifications) {
      // Queue for email delivery
      await this.queueEmailNotification(userId, notification)
    }

    if (prefs.pushNotifications) {
      // Queue for push notification delivery
      await this.queuePushNotification(userId, notification)
    }

    console.log('[Notification] Sent to', userId, ':', { type, title })

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
        system_alert: true,
      },
    }
  }

  private emitWebSocketEvent(userId: string, event: string, data: any): void {
    // In production, emit to WebSocket server
    console.log(`[WebSocket] ${event} for ${userId}:`, data)
  }

  private async queueEmailNotification(userId: string, notification: Notification): Promise<void> {
    // In production, queue to email service
    console.log('[Email Queue] Notification for', userId, ':', notification.title)
  }

  private async queuePushNotification(userId: string, notification: Notification): Promise<void> {
    // In production, queue to push notification service
    console.log('[Push Queue] Notification for', userId, ':', notification.title)
  }

  getUnreadCount(userId: string): number {
    const userNotifications = this.notifications.get(userId) || []
    return userNotifications.filter(n => !n.read).length
  }

  getNotificationStats(userId: string): {
    total: number
    unread: number
    byType: Record<NotificationType, number>
  } {
    const userNotifications = this.notifications.get(userId) || []

    const stats = {
      total: userNotifications.length,
      unread: userNotifications.filter(n => !n.read).length,
      byType: {} as Record<NotificationType, number>,
    }

    for (const notification of userNotifications) {
      stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1
    }

    return stats
  }
}

export function createNotificationService() {
  return new NotificationService()
}
