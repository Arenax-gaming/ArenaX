import { Request, Response } from 'express';
import { notificationService } from '../services/notification.service';

/** GET /api/v1/notifications */
export const getNotifications = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const filter = {
    read: req.query.unreadOnly === 'true' ? false : undefined,
  };
  const notifs = await notificationService.getNotifications(userId, filter);
  res.json(notifs);
};

/** POST /api/v1/notifications/:id/read */
export const markAsRead = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  await notificationService.markAsRead(userId, id);
  res.json({ success: true });
};

/** GET /me/preferences or /api/v1/notifications/preferences */
export const getMyPreferences = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

  const perEvent = await notificationService.getPerEventPreferences(userId);
  const globalPrefs = await notificationService.getPreferences(userId);
  res.json({
    preferences: perEvent,
    global: globalPrefs,
  });
};

/** PUT / POST / PATCH /me/preferences or /api/v1/notifications/preferences */
export const updatePreferences = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

  const body = req.body;

  // Single preference update: { eventType, channel, enabled }
  if (body.eventType && body.channel !== undefined) {
    const updated = await notificationService.setPreference(
      userId,
      body.eventType,
      body.channel,
      body.enabled !== false
    );
    return res.json({ success: true, updated });
  }

  // Array of preferences: [{ eventType, channel, enabled }, ...] or { preferences: [...] }
  const prefList = Array.isArray(body) ? body : body.preferences;
  if (Array.isArray(prefList)) {
    const updated = [];
    for (const item of prefList) {
      if (item.eventType && item.channel) {
        const rec = await notificationService.setPreference(
          userId,
          item.eventType,
          item.channel,
          item.enabled !== false
        );
        updated.push(rec);
      }
    }
    return res.json({ success: true, updated });
  }

  // Fallback to legacy global preferences object
  const updated = await notificationService.updatePreferences(userId, body);
  res.json(updated);
};

/** POST /api/v1/notifications/send (admin only) */
export const sendNotification = async (req: Request, res: Response) => {
  const admin = req.user?.role === 'admin';
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  const { userId, type, title, content } = req.body;
  const notif = await notificationService.sendNotification(userId, type, title, content);
  res.status(201).json(notif);
};

/** DELETE /api/v1/notifications/:id */
export const deleteNotification = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const success = await notificationService.deleteNotification(userId, id);
  res.json({ success });
};
