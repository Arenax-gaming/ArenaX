/**
 * Localised validation & API error messages.
 *
 * - Catalogs for en, es, fr, ar, yo (missing keys/locales fall back to English)
 * - API error codes mapped to i18n keys
 * - Pluralisation via Intl.PluralRules ({ one, other, ... } variants)
 * - Locale-aware date/number formatting via Intl
 */

export const VALIDATION_LOCALES = ["en", "es", "fr", "ar", "yo"] as const;
export type ValidationLocale = (typeof VALIDATION_LOCALES)[number];

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
type Message = string | PluralForms;
type Catalog = Record<string, Message>;

const en: Catalog = {
  required: "This field is required",
  invalidEmail: "Enter a valid email address",
  invalidFormat: "Invalid format",
  minLength: { one: "Must be at least {count} character", other: "Must be at least {count} characters" },
  maxLength: { one: "Must be at most {count} character", other: "Must be at most {count} characters" },
  minValue: "Must be at least {min}",
  maxValue: "Must be at most {max}",
  passwordMismatch: "Passwords do not match",
  invalidStellarKey: "Enter a valid Stellar public key",
  dateBefore: "Date must be before {date}",
  dateAfter: "Date must be after {date}",
  generic: "An unexpected error occurred. Please try again.",
  network: "Please check your internet connection and try again.",
  unauthorized: "You don't have permission to perform this action.",
  notFound: "The requested resource was not found.",
  rateLimited: { one: "Too many requests. Try again in {count} second.", other: "Too many requests. Try again in {count} seconds." },
  sessionExpired: "Your session has expired. Please sign in again.",
  serverError: "Our servers are having trouble. Please try again in a moment.",
  insufficientFunds: "Insufficient balance for this action.",
};

const es: Catalog = {
  required: "Este campo es obligatorio",
  invalidEmail: "Introduce un correo electrónico válido",
  invalidFormat: "Formato no válido",
  minLength: { one: "Debe tener al menos {count} carácter", other: "Debe tener al menos {count} caracteres" },
  maxLength: { one: "Debe tener como máximo {count} carácter", other: "Debe tener como máximo {count} caracteres" },
  minValue: "Debe ser al menos {min}",
  maxValue: "Debe ser como máximo {max}",
  passwordMismatch: "Las contraseñas no coinciden",
  invalidStellarKey: "Introduce una clave pública de Stellar válida",
  dateBefore: "La fecha debe ser anterior a {date}",
  dateAfter: "La fecha debe ser posterior a {date}",
  generic: "Se produjo un error inesperado. Inténtalo de nuevo.",
  network: "Comprueba tu conexión a internet e inténtalo de nuevo.",
  unauthorized: "No tienes permiso para realizar esta acción.",
  notFound: "No se encontró el recurso solicitado.",
  rateLimited: { one: "Demasiadas solicitudes. Inténtalo en {count} segundo.", other: "Demasiadas solicitudes. Inténtalo en {count} segundos." },
  sessionExpired: "Tu sesión ha expirado. Inicia sesión de nuevo.",
  serverError: "Nuestros servidores tienen problemas. Inténtalo en un momento.",
  insufficientFunds: "Saldo insuficiente para esta acción.",
};

const fr: Catalog = {
  required: "Ce champ est obligatoire",
  invalidEmail: "Saisissez une adresse e-mail valide",
  invalidFormat: "Format invalide",
  minLength: { one: "Doit contenir au moins {count} caractère", other: "Doit contenir au moins {count} caractères" },
  maxLength: { one: "Doit contenir au plus {count} caractère", other: "Doit contenir au plus {count} caractères" },
  minValue: "Doit être au moins {min}",
  maxValue: "Doit être au plus {max}",
  passwordMismatch: "Les mots de passe ne correspondent pas",
  invalidStellarKey: "Saisissez une clé publique Stellar valide",
  dateBefore: "La date doit être antérieure au {date}",
  dateAfter: "La date doit être postérieure au {date}",
  generic: "Une erreur inattendue s'est produite. Veuillez réessayer.",
  network: "Vérifiez votre connexion internet et réessayez.",
  unauthorized: "Vous n'êtes pas autorisé à effectuer cette action.",
  notFound: "La ressource demandée est introuvable.",
  rateLimited: { one: "Trop de requêtes. Réessayez dans {count} seconde.", other: "Trop de requêtes. Réessayez dans {count} secondes." },
  sessionExpired: "Votre session a expiré. Veuillez vous reconnecter.",
  serverError: "Nos serveurs rencontrent des difficultés. Réessayez dans un instant.",
  insufficientFunds: "Solde insuffisant pour cette action.",
};

const ar: Catalog = {
  required: "هذا الحقل مطلوب",
  invalidEmail: "أدخل عنوان بريد إلكتروني صالحًا",
  invalidFormat: "تنسيق غير صالح",
  minLength: {
    zero: "يجب ألا يقل عن {count} حرف",
    one: "يجب ألا يقل عن حرف واحد",
    two: "يجب ألا يقل عن حرفين",
    few: "يجب ألا يقل عن {count} أحرف",
    many: "يجب ألا يقل عن {count} حرفًا",
    other: "يجب ألا يقل عن {count} حرف",
  },
  maxLength: {
    zero: "يجب ألا يزيد عن {count} حرف",
    one: "يجب ألا يزيد عن حرف واحد",
    two: "يجب ألا يزيد عن حرفين",
    few: "يجب ألا يزيد عن {count} أحرف",
    many: "يجب ألا يزيد عن {count} حرفًا",
    other: "يجب ألا يزيد عن {count} حرف",
  },
  minValue: "يجب أن تكون القيمة {min} على الأقل",
  maxValue: "يجب أن تكون القيمة {max} على الأكثر",
  passwordMismatch: "كلمتا المرور غير متطابقتين",
  invalidStellarKey: "أدخل مفتاح Stellar عامًا صالحًا",
  dateBefore: "يجب أن يكون التاريخ قبل {date}",
  dateAfter: "يجب أن يكون التاريخ بعد {date}",
  generic: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.",
  network: "يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.",
  unauthorized: "ليس لديك إذن لتنفيذ هذا الإجراء.",
  notFound: "لم يتم العثور على المورد المطلوب.",
  rateLimited: {
    one: "طلبات كثيرة جدًا. حاول بعد ثانية واحدة.",
    two: "طلبات كثيرة جدًا. حاول بعد ثانيتين.",
    few: "طلبات كثيرة جدًا. حاول بعد {count} ثوانٍ.",
    other: "طلبات كثيرة جدًا. حاول بعد {count} ثانية.",
  },
  sessionExpired: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
  serverError: "تواجه خوادمنا مشكلة. يرجى المحاولة بعد قليل.",
  insufficientFunds: "الرصيد غير كافٍ لهذا الإجراء.",
};

const yo: Catalog = {
  required: "Aaye yii jẹ dandan",
  invalidEmail: "Tẹ adirẹsi imeeli to wulo",
  invalidFormat: "Ọna kikọ ko tọ",
  minLength: { other: "Gbọdọ ni o kere ju lẹta {count}" },
  maxLength: { other: "Ko gbọdọ ju lẹta {count} lọ" },
  minValue: "Gbọdọ jẹ o kere ju {min}",
  maxValue: "Ko gbọdọ ju {max} lọ",
  passwordMismatch: "Awọn ọrọ igbaniwọle ko baramu",
  invalidStellarKey: "Tẹ kọkọrọ gbangba Stellar to wulo",
  dateBefore: "Ọjọ gbọdọ ṣaaju {date}",
  dateAfter: "Ọjọ gbọdọ jẹ lẹhin {date}",
  generic: "Aṣiṣe airotẹlẹ kan waye. Jọwọ gbiyanju lẹẹkansi.",
  network: "Jọwọ ṣayẹwo asopọ intanẹẹti rẹ ki o gbiyanju lẹẹkansi.",
  unauthorized: "O ko ni aṣẹ lati ṣe iṣe yii.",
  notFound: "A ko ri ohun ti o beere.",
  rateLimited: { other: "Awọn ibeere ti pọ ju. Gbiyanju lẹhin iṣẹju-aaya {count}." },
  sessionExpired: "Igba rẹ ti pari. Jọwọ wọle lẹẹkansi.",
  serverError: "Awọn olupin wa ni wahala. Jọwọ gbiyanju laipẹ.",
  insufficientFunds: "Owo ko to fun iṣe yii.",
};

const CATALOGS: Record<ValidationLocale, Catalog> = { en, es, fr, ar, yo };

/** Maps backend API error codes to validation i18n keys. */
export const API_ERROR_CODE_MAP: Record<string, string> = {
  VALIDATION_REQUIRED: "required",
  VALIDATION_EMAIL: "invalidEmail",
  VALIDATION_FORMAT: "invalidFormat",
  VALIDATION_MIN_LENGTH: "minLength",
  VALIDATION_MAX_LENGTH: "maxLength",
  VALIDATION_MIN: "minValue",
  VALIDATION_MAX: "maxValue",
  INVALID_STELLAR_KEY: "invalidStellarKey",
  NETWORK_ERROR: "network",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "unauthorized",
  NOT_FOUND: "notFound",
  RATE_LIMITED: "rateLimited",
  TOKEN_EXPIRED: "sessionExpired",
  SESSION_EXPIRED: "sessionExpired",
  INTERNAL_ERROR: "serverError",
  INSUFFICIENT_FUNDS: "insufficientFunds",
};

export type MessageParams = Record<string, string | number | Date>;

export function resolveValidationLocale(locale?: string): ValidationLocale {
  const base = (locale ?? "en").toLowerCase().split(/[-_]/)[0];
  return (VALIDATION_LOCALES as readonly string[]).includes(base!)
    ? (base as ValidationLocale)
    : "en";
}

export function formatValidationNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(resolveValidationLocale(locale)).format(value);
}

export function formatValidationDate(
  value: Date | string | number,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(resolveValidationLocale(locale), options).format(new Date(value));
}

function pickPlural(message: PluralForms, count: number, locale: ValidationLocale): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return message[rule] ?? message.other;
}

/**
 * Translate a validation message key. Falls back to English when the key is
 * missing for the locale, and to the key itself when missing everywhere.
 * Number params are locale-formatted, Date params use the locale date style,
 * and `count` selects the plural form.
 */
export function translateValidation(
  key: string,
  locale?: string,
  params: MessageParams = {},
): string {
  const loc = resolveValidationLocale(locale);
  const message = CATALOGS[loc][key] ?? en[key];
  if (message === undefined) return key;

  const count = typeof params.count === "number" ? params.count : undefined;
  const template =
    typeof message === "string"
      ? message
      : pickPlural(message, count ?? 0, CATALOGS[loc][key] ? loc : "en");

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    if (value instanceof Date) return formatValidationDate(value, loc);
    if (typeof value === "number") return formatValidationNumber(value, loc);
    return value;
  });
}

/** Translate a backend API error code, falling back to the generic message. */
export function translateApiError(
  code: string | undefined,
  locale?: string,
  params?: MessageParams,
): string {
  const key = (code && API_ERROR_CODE_MAP[code]) ?? "generic";
  return translateValidation(key, locale, params);
}
