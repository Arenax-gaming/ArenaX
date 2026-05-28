import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';

const notificationService = new NotificationService();

/** GET /api/v1/notifications */
export const getNotifications = async (req: Request, res: Response) => {
  const userId = req.user?.id; // Assuming auth middleware sets req.user
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const filter = {
    unreadOnly: req.query.unreadOnly === 'true',
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

/** POST /api/v1/notifications/preferences */
export const updatePreferences = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const prefs = req.body;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const updated = await notificationService.updatePreferences(userId, prefs);
  res.json(updated);
};

/** POST /api/v1/notifications/send (admin only) */
export const sendNotification = async (req: Request, res: Response) => {
  // Simple admin guard – in production replace with proper role check
  const admin = req.user?.isAdmin;
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
