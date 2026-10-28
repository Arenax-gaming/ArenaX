import { Router } from 'express';
import multer from 'multer';
import { reportScore, raiseDispute, createMatch } from '../controllers/match.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

const screenshotUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_req, file, callback) => {
        if (['image/jpeg', 'image/png'].includes(file.mimetype)) {
            callback(null, true);
        } else {
            callback(new Error('Screenshot must be a JPEG or PNG image'));
        }
    },
});

router.use(authenticateJWT);

router.post('/', paymentRateLimiter, createMatch);
router.post(
    '/:id/report',
    paymentRateLimiter,
    screenshotUpload.single('screenshot'),
    reportScore
);
router.post('/:id/dispute', paymentRateLimiter, raiseDispute);

export default router;
