import { z } from 'zod';
import { parseBool, parseSubscriptionEnv } from '@zayush/shared';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  /** Публичный HTTPS-адрес Mini App (тот же сервер или CDN) */
  WEBAPP_URL: z.string().default('http://localhost:5173'),
  BOT_TOKEN: z.string().default(''),
  /** off | polling | webhook */
  BOT_MODE: z.enum(['off', 'polling', 'webhook']).default('off'),
  /** Публичный адрес API для регистрации webhook (если отличается от WEBAPP_URL) */
  PUBLIC_API_URL: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  /** Сколько секунд initData считается свежей */
  INITDATA_MAX_AGE_SEC: z.coerce.number().int().positive().default(86_400),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  ADMIN_API_TOKEN: z.string().default(''),
  /** Только для локальной разработки вне Telegram. В production запрещено. */
  DEV_AUTH_BYPASS: z.string().default('false'),
  REQUIRE_SUBSCRIPTION: z.string().default('false'),
  REQUIRED_CHANNELS: z.string().default(''),
  REQUIRED_GROUPS: z.string().default(''),
  /** Сколько минут действует успешная проверка подписки */
  SUBSCRIPTION_TTL_MIN: z.coerce.number().int().positive().default(15),
  /** Сколько часов пускать пользователя с прошлой успешной проверкой, если Telegram API недоступен */
  SUBSCRIPTION_GRACE_HOURS: z.coerce.number().int().min(0).default(24),
  REMINDERS_ENABLED: z.string().default('false'),
  /** Час отправки напоминаний по Москве */
  REMINDER_HOUR_MSK: z.coerce.number().int().min(0).max(23).default(19),
  UPLOAD_DIR: z.string().default('./uploads'),
  WEB_DIST_DIR: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  /** Подключение AI-помощника (по умолчанию выключено) */
  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default(''),

  // ── Оператор персональных данных (152-ФЗ). Подставляется в политику, согласие и соглашение ──
  /** ФИО индивидуального предпринимателя / самозанятого или наименование организации */
  LEGAL_OPERATOR_NAME: z.string().default(''),
  /** ИНН оператора */
  LEGAL_OPERATOR_INN: z.string().default(''),
  /** ОГРН / ОГРНИП (если есть) */
  LEGAL_OPERATOR_OGRN: z.string().default(''),
  /** Почтовый адрес для обращений субъектов ПДн (необязательно для самозанятых — тогда только e-mail) */
  LEGAL_OPERATOR_ADDRESS: z.string().default(''),
  /** E-mail для запросов субъектов ПДн и отзыва согласия */
  LEGAL_CONTACT_EMAIL: z.string().default(''),
  /** Дата редакции документов (ДД.ММ.ГГГГ) */
  LEGAL_DOCS_DATE: z.string().default('23.10.2026'),
  /** Где физически расположены серверы с базой данных (ч. 5 ст. 18 152-ФЗ — должна быть РФ) */
  LEGAL_SERVER_LOCATION: z.string().default('Российская Федерация'),
  /** Секрет для обезличенных хэшей (журнал согласий, хэш телефона). Не короче 32 символов в production. */
  PD_HASH_SECRET: z.string().default('dev-only-pd-hash-secret-change-me-0000'),
  /** Через сколько дней без входа аккаунт и все данные удаляются автоматически (0 — не удалять) */
  RETENTION_INACTIVE_DAYS: z.coerce.number().int().min(0).default(1095),

  // ── Подтверждение российского номера телефона (149-ФЗ, ч. 10 ст. 8; ответственность — ст. 13.55 КоАП с 07.07.2026) ──
  AUTH_RU_PHONE_REQUIRED: z.string().default('false'),
  /** console — код пишется в лог (только разработка); smsru — отправка через sms.ru */
  SMS_PROVIDER: z.enum(['console', 'smsru']).default('console'),
  SMSRU_API_ID: z.string().default(''),
});

export type Env = ReturnType<typeof loadEnv>;

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ошибка конфигурации: ${msg}`);
  }
  const e = parsed.data;
  const devAuthBypass = parseBool(e.DEV_AUTH_BYPASS);
  if (e.NODE_ENV === 'production') {
    if (devAuthBypass) throw new Error('DEV_AUTH_BYPASS нельзя включать в production');
    if (!e.BOT_TOKEN) throw new Error('В production нужен BOT_TOKEN — без него нельзя проверить Telegram initData');
    if (e.ADMIN_API_TOKEN && e.ADMIN_API_TOKEN.length < 32) throw new Error('ADMIN_API_TOKEN должен быть не короче 32 символов');
    if (e.BOT_MODE === 'webhook' && e.TELEGRAM_WEBHOOK_SECRET.length < 16)
      throw new Error('Для webhook задайте TELEGRAM_WEBHOOK_SECRET (не короче 16 символов)');
    const missing = (['LEGAL_OPERATOR_NAME', 'LEGAL_OPERATOR_INN', 'LEGAL_CONTACT_EMAIL'] as const).filter((k) => !e[k].trim());
    if (missing.length)
      throw new Error(`Для публичного запуска укажите данные оператора ПДн (152-ФЗ): ${missing.join(', ')}`);
    if (e.PD_HASH_SECRET.length < 32 || e.PD_HASH_SECRET.startsWith('dev-only'))
      throw new Error('PD_HASH_SECRET: задайте случайную строку не короче 32 символов');
    if (parseBool(e.AUTH_RU_PHONE_REQUIRED) && (e.SMS_PROVIDER !== 'smsru' || !e.SMSRU_API_ID))
      throw new Error('AUTH_RU_PHONE_REQUIRED включён: задайте SMS_PROVIDER=smsru и SMSRU_API_ID');
  }
  const subscription = parseSubscriptionEnv(source);
  return {
    ...e,
    isProd: e.NODE_ENV === 'production',
    devAuthBypass,
    remindersEnabled: parseBool(e.REMINDERS_ENABLED),
    phoneRequired: parseBool(e.AUTH_RU_PHONE_REQUIRED),
    adminTelegramIds: new Set(
      e.ADMIN_TELEGRAM_IDS.split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s)),
    ),
    subscription,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
