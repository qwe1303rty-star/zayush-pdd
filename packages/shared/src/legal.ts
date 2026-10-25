/**
 * Юридические константы приложения.
 * При существенном изменении политики или текста согласия увеличьте CONSENT_VERSION —
 * все пользователи увидят экран согласия заново (152-ФЗ, ст. 9).
 */
export const CONSENT_VERSION = '2026-10-23';

/** Возрастная маркировка информационной продукции (436-ФЗ, ст. 6–9) */
export const AGE_RATING = '12+';

export const LEGAL_DOCS = [
  { slug: 'privacy', title: 'Политика обработки персональных данных' },
  { slug: 'consent', title: 'Согласие на обработку персональных данных' },
  { slug: 'terms', title: 'Пользовательское соглашение' },
  { slug: 'licenses', title: 'Источники и лицензии' },
] as const;

export type LegalDocSlug = (typeof LEGAL_DOCS)[number]['slug'];

export interface LegalDocDTO {
  slug: LegalDocSlug;
  title: string;
  /** Готовый HTML документа (формируется на сервере из шаблона, пользовательского ввода не содержит) */
  html: string;
  updatedAt: string;
}

export interface ConsentStatusDTO {
  /** Нужно ли показать экран согласия */
  required: boolean;
  version: string;
  ageRating: string;
  /** Нужна ли проверка российского номера телефона после согласия */
  phoneRequired: boolean;
  /** Номер уже подтверждён */
  phoneVerified: boolean;
  docs: { slug: LegalDocSlug; title: string }[];
  operatorName: string;
}

/** Нормализует российский мобильный номер к виду 79XXXXXXXXX. Возвращает null, если номер не российский мобильный. */
export function normalizeRuPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10 && d.startsWith('9')) d = '7' + d;
  return /^79\d{9}$/.test(d) ? d : null;
}
