import { timingSafeEqual } from 'node:crypto';
import { CONSENT_VERSION } from '@zayush/shared';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { InitDataValidationError, verifyInitData } from '../telegram/init-data.js';

const DEV_USER = { id: 100_000_001, first_name: 'Разработчица' };

export interface TelegramUser {
  id: number;
  first_name: string;
  allows_write_to_pm?: boolean;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Маршрут доступен до подтверждения телефона (экран подтверждения) */
    skipPhone?: boolean;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Проверяет подпись Telegram initData и возвращает пользователя Telegram.
 * Клиент присылает данные в заголовке  Authorization: tma <initData>.
 * Telegram ID, переданный клиентом отдельно, никогда не используется как доказательство личности.
 */
export function resolveTelegramUser(ctx: AppContext, req: FastifyRequest): TelegramUser {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('tma ')) {
    try {
      return verifyInitData(header.slice(4), ctx.env.BOT_TOKEN, ctx.env.INITDATA_MAX_AGE_SEC).user;
    } catch (e) {
      if (e instanceof InitDataValidationError) {
        req.log.info({ reason: e.reason }, 'initData rejected');
        throw errors.unauthorized();
      }
      throw e;
    }
  }
  // Локальная разработка в обычном браузере: фиксированный тестовый пользователь
  if (ctx.env.devAuthBypass && !ctx.env.isProd) return DEV_USER;
  throw errors.unauthorized();
}

const SEEN_UPDATE_MS = 6 * 60 * 60 * 1000;

/**
 * Аутентификация для всех пользовательских маршрутов.
 * Учётная запись создаётся ТОЛЬКО после согласия на обработку ПДн (POST /api/consent, 152-ФЗ):
 * без согласия или при новой версии документа запросы отклоняются с кодом CONSENT_REQUIRED.
 */
export function makeAuthenticate(ctx: AppContext) {
  return async function authenticate(req: FastifyRequest) {
    const tgUser = resolveTelegramUser(ctx, req);
    const telegramId = BigInt(tgUser.id);
    let user = await ctx.db.user.findUnique({ where: { telegramId } });
    if (!user || user.consentVersion !== CONSENT_VERSION) throw errors.consentRequired();
    if (user.isBlocked) throw errors.forbidden();

    const name = tgUser.first_name.slice(0, 64);
    const now = new Date();
    const stale = now.getTime() - user.lastSeenAt.getTime() > SEEN_UPDATE_MS;
    if (stale || user.firstName !== name || (tgUser.allows_write_to_pm === true && !user.botCanWrite)) {
      user = await ctx.db.user.update({
        where: { id: user.id },
        data: {
          firstName: name,
          lastSeenAt: now,
          ...(tgUser.allows_write_to_pm === true ? { botCanWrite: true } : {}),
        },
      });
    }

    // Трекинг сессий для статистики времени в приложении
    const SESSION_GAP_MS = 30 * 60 * 1000;
    const lastSession = await ctx.db.userSession.findFirst({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' } });
    if (!lastSession || now.getTime() - lastSession.lastSeenAt.getTime() > SESSION_GAP_MS) {
      await ctx.db.userSession.create({ data: { userId: user.id } });
    } else {
      await ctx.db.userSession.update({ where: { id: lastSession.id }, data: { lastSeenAt: now } });
    }

    req.user = user;
    req.isAdmin = ctx.env.adminTelegramIds.has(String(user.telegramId));

    if (ctx.env.phoneRequired && !user.phoneVerifiedAt && !req.routeOptions.config?.skipPhone) throw errors.phoneRequired();
  };
}

/**
 * Админ-доступ: Telegram ID из ADMIN_TELEGRAM_IDS (серверная конфигурация)
 * или заголовок X-Admin-Token, совпадающий с ADMIN_API_TOKEN (для работы из обычного браузера).
 */
export function makeAuthenticateAdmin(ctx: AppContext, authenticate: (req: FastifyRequest) => Promise<void>) {
  return async function authenticateAdmin(req: FastifyRequest) {
    const token = req.headers['x-admin-token'];
    if (typeof token === 'string' && ctx.env.ADMIN_API_TOKEN && safeEqual(token, ctx.env.ADMIN_API_TOKEN)) {
      req.isAdmin = true;
      return;
    }
    await authenticate(req);
    if (!req.isAdmin) throw errors.forbidden();
  };
}
