import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import type { AppContext } from './context.js';
import { createDb } from './db.js';
import type { Env } from './env.js';
import { AppError } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { legalApiRoutes, legalPublicRoutes } from './routes/legal.js';
import { userRoutes } from './routes/user.js';
import { LegalService } from './services/legal.js';
import { ActivityService } from './services/activity.js';
import { ConsoleSms, type SmsSender, SmsRu } from './services/sms.js';
import { AnthropicProvider, AssistantService } from './services/assistant.js';
import { ExamService } from './services/exam.js';
import { LearningService } from './services/learning.js';
import { Notifier } from './services/notify.js';
import { ProfileService } from './services/profile.js';
import { SettingsService } from './services/settings.js';
import { SubscriptionService } from './services/subscription.js';
import { type ChatMemberChecker, NoTokenMemberChecker, TelegramMemberChecker } from './telegram/member-checker.js';

export interface BuildOptions {
  env: Env;
  checker?: ChatMemberChecker;
  sms?: SmsSender;
  bot?: Bot | null;
  logger?: boolean;
  rng?: () => number;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { env } = opts;
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: env.isProd ? 'info' : 'debug',
            redact: ['req.headers.authorization', 'req.headers["x-admin-token"]'],
            // Минимизация ПДн в журналах: без IP, порта и заголовков; query-строку не пишем
            serializers: {
              req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
            },
          },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  const db = createDb(env.DATABASE_URL);
  const settings = new SettingsService(db);
  const learning = new LearningService(db, settings);
  const exam = new ExamService(db, learning, settings, opts.rng);
  const checker = opts.checker ?? (env.BOT_TOKEN ? new TelegramMemberChecker(env.BOT_TOKEN) : new NoTokenMemberChecker());
  const subscription = new SubscriptionService(
    db,
    settings,
    checker,
    {
      envEnabled: env.subscription.enabled,
      envSources: env.subscription.sources,
      ttlMinutes: env.SUBSCRIPTION_TTL_MIN,
      graceHours: env.SUBSCRIPTION_GRACE_HOURS,
    },
    app.log,
  );
  const profile = new ProfileService(db, learning, settings, subscription);
  const ai = env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY && env.AI_MODEL ? new AnthropicProvider(env.AI_API_KEY, env.AI_MODEL) : null;
  const assistant = new AssistantService(db, ai);
  const notifier = new Notifier(db, opts.bot?.api ?? null, env.WEBAPP_URL, app.log);
  const legal = new LegalService(env);
  const sms = opts.sms ?? (env.SMS_PROVIDER === 'smsru' && env.SMSRU_API_ID ? new SmsRu(env.SMSRU_API_ID) : new ConsoleSms(app.log));
  const activity = new ActivityService(db, env);
  const ctx: AppContext = { env, db, settings, learning, exam, subscription, profile, assistant, notifier, legal, sms, activity };
  if (env.isProd && !env.phoneRequired)
    app.log.warn(
      'AUTH_RU_PHONE_REQUIRED выключен: вход только через Telegram. С 07.07.2026 действует ст. 13.55 КоАП (ч. 10 ст. 8 149-ФЗ) — см. docs/legal.md',
    );

  for (const e of env.subscription.errors) app.log.warn(`Подписка: ${e}`);

  await app.register(helmet, {
    // Mini App открывается во фрейме Telegram Web — запрещать фреймы нельзя, но ограничиваем источники
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      // initData уникальна для пользователя, поэтому ключ — её хэш, а не только IP (NAT мобильных операторов)
      return auth ? createHash('sha256').update(auth).digest('hex').slice(0, 24) : req.ip;
    },
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Кисуль, не так быстро 💗 Подожди минутку.' } }),
  });

  if (env.corsOrigins.length) {
    app.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && env.corsOrigins.includes(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Vary', 'Origin');
        reply.header('Access-Control-Allow-Headers', 'authorization, content-type, x-admin-token');
        reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        if (req.method === 'OPTIONS') return reply.code(204).send();
      }
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, подожди минутку.' } });
    if (e.code === 'P2025') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
    if (e.code === 'P2002') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Такая запись уже есть' } });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)
      return reply.code(e.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'Некорректный запрос' } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Ой, что-то пошло не так. Попробуй ещё раз.' } });
  });

  // ── Публичные эндпоинты ──
  app.get('/api/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  });
  app.get('/api/config', async () => ({
    devAuth: env.devAuthBypass && !env.isProd,
    phoneRequired: env.phoneRequired,
    assistantMode: assistant.mode,
  }));

  // ── Telegram webhook ──
  if (opts.bot && env.BOT_MODE === 'webhook') {
    app.post(
      '/telegram/webhook',
      { config: { rateLimit: false } },
      webhookCallback(opts.bot, 'fastify', { secretToken: env.TELEGRAM_WEBHOOK_SECRET }),
    );
  }

  await app.register(async (p) => legalPublicRoutes(p, ctx));
  await app.register(async (p) => legalApiRoutes(p, ctx), { prefix: '/api' });
  await app.register(async (p) => userRoutes(p, ctx), { prefix: '/api' });
  await app.register(async (p) => adminRoutes(p, ctx), { prefix: '/api/admin' });

  // Загруженные админом изображения
  const uploadDir = resolve(env.UPLOAD_DIR);
  if (existsSync(uploadDir) || env.isProd) {
    await app.register(fastifyStatic, {
      root: uploadDir,
      prefix: '/uploads/',
      decorateReply: false,
      setHeaders: (res) => {
        res.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
        res.header('X-Content-Type-Options', 'nosniff');
        res.header('Cache-Control', 'public, max-age=604800');
      },
    });
  }

  // Собранный фронтенд (production): один origin для Mini App и API
  const webDist = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
      setHeaders: (res, path) => {
        if (path.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else if (path.endsWith('index.html')) res.header('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/uploads') && !req.url.startsWith('/legal')) {
        return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html', webDist);
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
    });
  }

  app.addHook('onClose', async () => {
    await db.$disconnect();
  });

  return { app, ctx };
}
