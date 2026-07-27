import fs from 'fs';
import path from 'path';
import { logger } from './logger.service';

export interface BackendLocale {
  code: string;
  label: string;
  direction: 'ltr' | 'rtl';
}

export const SUPPORTED_LOCALES: BackendLocale[] = [
  { code: 'en', label: 'English', direction: 'ltr' },
  { code: 'es', label: 'Spanish', direction: 'ltr' },
  { code: 'fr', label: 'French', direction: 'ltr' },
  { code: 'ar', label: 'Arabic', direction: 'rtl' },
  { code: 'yo', label: 'Yoruba', direction: 'ltr' },
];

export const DEFAULT_LOCALE = 'en';

class I18nService {
  private translations: Map<string, Record<string, string>> = new Map();
  private loadedAt = new Map<string, number>();

  constructor(private readonly baseDir: string) {}

  async loadLocale(locale: string): Promise<Record<string, string>> {
    const normalized = SUPPORTED_LOCALES.find(l => l.code === locale)?.code ?? DEFAULT_LOCALE;
    if (this.translations.has(normalized)) {
      return this.translations.get(normalized)!;
    }

    const filePath = path.join(this.baseDir, `${normalized}.json`);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      this.translations.set(normalized, parsed);
      this.loadedAt.set(normalized, Date.now());
      return parsed;
    } catch (err) {
      logger.warn('Failed to load backend translation bundle', { locale: normalized, error: err });
      const fallback = this.translations.get(DEFAULT_LOCALE) ?? {};
      return fallback;
    }
  }

  getDirection(locale: string): 'ltr' | 'rtl' {
    return SUPPORTED_LOCALES.find(l => l.code === locale)?.direction ?? 'ltr';
  }

  t(locale: string, key: string, fallback?: string): string {
    const bundle = this.translations.get(locale) ?? this.translations.get(DEFAULT_LOCALE) ?? {};
    const value = bundle[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof fallback === 'string') return fallback;
    return key;
  }

  getLocales(): BackendLocale[] {
    return SUPPORTED_LOCALES;
  }

  getDefaultLocale(): string {
    return DEFAULT_LOCALE;
  }

  invalidate(locale?: string): void {
    if (locale) {
      this.translations.delete(locale);
      this.loadedAt.delete(locale);
      return;
    }
    this.translations.clear();
    this.loadedAt.clear();
  }
}

export const i18nService = new I18nService(path.join(process.cwd(), 'server', 'locales'));

export async function initBackendI18n(): Promise<void> {
  for (const locale of SUPPORTED_LOCALES.map(l => l.code)) {
    await i18nService.loadLocale(locale);
  }
  logger.info('Backend i18n initialized', { locales: SUPPORTED_LOCALES.map(l => l.code) });
}