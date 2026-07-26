import { Request, Response, NextFunction } from 'express';
import { i18nService, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../services/i18n.service';

export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['accept-language'];
  const preferred = chooseLocale(header);
  (req as any).locale = preferred;
  next();
}

export function chooseLocale(acceptLanguage?: string | string[]): string {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const parts = Array.isArray(acceptLanguage) ? acceptLanguage.join(',') : acceptLanguage;
  const candidates = parts
    .split(',')
    .map(item => item.trim().split(';')[0]!.toLowerCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.startsWith('en-')) return 'en';
    const exact = SUPPORTED_LOCALES.find(l => l.code === candidate);
    if (exact) return exact.code;
  }
  return DEFAULT_LOCALE;
}

export { SUPPORTED_LOCALES, DEFAULT_LOCALE };