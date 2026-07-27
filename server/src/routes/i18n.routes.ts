import { Router } from 'express';
import { i18nService, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../services/i18n.service';

const router = Router();

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