import { Router } from 'express';
import {
  getNotifications,
  markAsRead,
  getMyPreferences,
  updatePreferences,
  sendNotification,
  deleteNotification,
} from '../controllers/notification.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router: Router = Router();

router.get('/', authenticateJWT, getNotifications);
router.post('/:id/read', authenticateJWT, markAsRead);
router.get('/preferences', authenticateJWT, getMyPreferences);
router.post('/preferences', authenticateJWT, updatePreferences);
router.put('/preferences', authenticateJWT, updatePreferences);
router.patch('/preferences', authenticateJWT, updatePreferences);
router.get('/me/preferences', authenticateJWT, getMyPreferences);
router.post('/me/preferences', authenticateJWT, updatePreferences);
router.put('/me/preferences', authenticateJWT, updatePreferences);
router.patch('/me/preferences', authenticateJWT, updatePreferences);
router.post('/send', authenticateJWT, sendNotification);
router.delete('/:id', authenticateJWT, deleteNotification);

export default router;
