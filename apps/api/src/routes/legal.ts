import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AGE_RATING, CONSENT_VERSION, type ConsentStatusDTO, LEGAL_DOCS, type LegalDocSlug, normalizeRuPhone } from '@zayush/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { makeAuthenticate, resolveTelegramUser } from '../plugins/auth.js';
import { grantStarterRewards } from '../services/gamification.js';
import { phoneHash, subjectHash } from '../services/legal.js';
import { parse } from './user.js';

const isSlug = (s: string): s is LegalDocSlug => LEGAL_DOCS.some((d) => d.slug === s);

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_PER_DAY = 5;

/** Публичные документы (без авторизации): ссылка для BotFather, бота и вне Telegram */
export async function legalPublicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/legal', async (_req, reply) => reply.redirect('/legal/privacy'));
  app.get('/legal/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!isSlug(slug)) throw errors.notFound('Документ не найден');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'public, max-age=600').send(ctx.legal.page(slug));
  });
}

/** API документов, согласия, подтверждения телефона и удаления аккаунта (префикс /api) */
export async function legalApiRoutes(app: FastifyInstance, ctx: AppContext) {
  const docsList = LEGAL_DOCS.map((d) => ({ slug: d.slug, title: d.title }));

  app.get('/legal', async () => ({ docs: docsList, operator: ctx.legal.operator.name, ageRating: AGE_RATING }));
  app.get('/legal/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    if (!isSlug(slug)) throw errors.notFound('Документ не найден');
    return ctx.legal.doc(slug);
  });

  // ── Согласие на обработку ПДн ──
  app.get('/consent', async (req): Promise<ConsentStatusDTO> => {
    const tg = resolveTelegramUser(ctx, req);
    const user = await ctx.db.user.findUnique({
      where: { telegramId: BigInt(tg.id) },
      select: { consentVersion: true, phoneVerifiedAt: true },
    });
    return {
      required: !user || user.consentVersion !== CONSENT_VERSION,
      version: CONSENT_VERSION,
      ageRating: AGE_RATING,
      phoneRequired: ctx.env.phoneRequired,
      phoneVerified: !!user?.phoneVerifiedAt,
      docs: docsList,
      operatorName: ctx.legal.operator.name,
    };
  });

  app.post('/consent', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const tg = resolveTelegramUser(ctx, req);
    const body = parse(
      z.object({
        version: z.literal(CONSENT_VERSION, { message: 'Документ обновился — обнови страницу' }),
        acceptPolicy: z.literal(true, { message: 'Нужно принять политику и согласие' }),
        ageConfirmed: z.literal(true, { message: 'Подтверди возраст или согласие родителя' }),
      }),
      req.body,
    );
    const telegramId = BigInt(tg.id);
    const now = new Date();
    const ranks = await ctx.settings.ranks();
    await ctx.db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { telegramId }, select: { id: true } });
      const user = await tx.user.upsert({
        where: { telegramId },
        create: {
          telegramId,
          firstName: tg.first_name.slice(0, 64),
          botCanWrite: tg.allows_write_to_pm === true,
          consentAt: now,
          consentVersion: body.version,
          lastSeenAt: now,
        },
        update: { consentAt: now, consentVersion: body.version, lastSeenAt: now },
      });
      if (!existing) await grantStarterRewards(tx, user.id, ranks);
      await tx.consentLog.create({ data: { subjectHash: subjectHash(ctx.env, telegramId), action: 'GRANTED', version: body.version } });
    });
    return { ok: true, phoneRequired: ctx.env.phoneRequired };
  });

  // ── Всё ниже — для пользователей, уже давших согласие ──
  app.register(async (p) => {
    p.addHook('preHandler', makeAuthenticate(ctx));

    /** Удаление аккаунта = отзыв согласия: данные удаляются сразу и полностью (каскадно) */
    p.delete('/me', { config: { skipPhone: true } }, async (req) => {
      parse(z.object({ confirm: z.literal('DELETE') }), req.body);
      const sh = subjectHash(ctx.env, req.user.telegramId);
      await ctx.db.$transaction([
        ctx.db.consentLog.create({ data: { subjectHash: sh, action: 'WITHDRAWN', version: req.user.consentVersion ?? CONSENT_VERSION } }),
        ctx.db.phoneCode.deleteMany({ where: { subjectHash: sh } }),
        ctx.db.user.delete({ where: { id: req.user.id } }),
      ]);
      req.log.info('account deleted by user');
      return { ok: true };
    });

    // ── Подтверждение российского номера (149-ФЗ, ч. 10 ст. 8) ──
    p.post(
      '/phone/start',
      { config: { skipPhone: true, rateLimit: { max: 3, timeWindow: '10 minutes' } } },
      async (req) => {
        if (!ctx.env.phoneRequired) throw errors.badRequest('Подтверждение телефона не требуется');
        const body = parse(z.object({ phone: z.string().max(32) }), req.body);
        const phone = normalizeRuPhone(body.phone);
        if (!phone) throw errors.badRequest('Нужен российский мобильный номер в формате +7 9XX XXX-XX-XX');
        const sh = subjectHash(ctx.env, req.user.telegramId);
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const sent = await ctx.db.phoneCode.count({ where: { subjectHash: sh, createdAt: { gte: since } } });
        if (sent >= MAX_CODES_PER_DAY) throw errors.conflict('TOO_MANY_CODES', 'Слишком много попыток. Попробуй завтра 💗');
        const code = String(randomInt(100000, 1000000));
        await ctx.db.phoneCode.create({
          data: {
            subjectHash: sh,
            phoneHash: phoneHash(ctx.env, phone),
            codeHash: codeHash(ctx.env.PD_HASH_SECRET, sh, code),
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
          },
        });
        try {
          await ctx.sms.send(phone, `Заюш ПДД: код ${code}. Никому его не сообщай.`);
        } catch {
          throw errors.conflict('SMS_FAILED', 'Не получилось отправить SMS. Проверь номер и попробуй ещё раз.');
        }
        return { ok: true, ttlSec: CODE_TTL_MS / 1000 };
      },
    );

    p.post(
      '/phone/verify',
      { config: { skipPhone: true, rateLimit: { max: 10, timeWindow: '10 minutes' } } },
      async (req) => {
        const body = parse(z.object({ code: z.string().regex(/^\d{6}$/, 'Код — 6 цифр') }), req.body);
        const sh = subjectHash(ctx.env, req.user.telegramId);
        const pc = await ctx.db.phoneCode.findFirst({ where: { subjectHash: sh }, orderBy: { createdAt: 'desc' } });
        if (!pc || pc.expiresAt < new Date() || pc.attempts >= MAX_CODE_ATTEMPTS)
          throw errors.conflict('CODE_EXPIRED', 'Код устарел. Запроси новый 💗');
        const ok = safeEq(pc.codeHash, codeHash(ctx.env.PD_HASH_SECRET, sh, body.code));
        if (!ok) {
          await ctx.db.phoneCode.update({ where: { id: pc.id }, data: { attempts: { increment: 1 } } });
          throw errors.badRequest('Неверный код');
        }
        await ctx.db.$transaction([
          ctx.db.user.update({ where: { id: req.user.id }, data: { phoneHash: pc.phoneHash, phoneVerifiedAt: new Date() } }),
          ctx.db.phoneCode.deleteMany({ where: { subjectHash: sh } }),
        ]);
        return { ok: true };
      },
    );
  });
}

function codeHash(secret: string, subject: string, code: string) {
  return createHmac('sha256', secret).update(`code:${subject}:${code}`).digest('hex');
}

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
