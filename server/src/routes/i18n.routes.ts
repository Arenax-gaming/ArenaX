import { Router } from 'express';
import { i18nService, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../services/i18n.service';

const router = Router();

/**
 * @openapi
 * /v1/i18n/locales:
 *   get:
 *     summary: Get i18n locales
 *     tags: [I18N]
 *     security: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/locales', (_req, res) => {
  res.json({
    locales: SUPPORTED_LOCALES.map(locale => ({
      code: locale.code,
      label: locale.label,
      direction: locale.direction,
    })),
    default: DEFAULT_LOCALE,
  });
});

/**
 * @openapi
 * /v1/i18n/locales/{locale}:
 *   get:
 *     summary: Get i18n locales
 *     tags: [I18N]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: locale
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/locales/:locale', async (req, res) => {
  const locale = req.params.locale;
  const bundle = await i18nService.loadLocale(locale);
  res.json({
    locale,
    direction: i18nService.getDirection(locale),
    keys: Object.keys(bundle),
  });
});

export default router;