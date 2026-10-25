import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONSENT_VERSION } from '@zayush/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { importContent, seedDefaults, type ContentFile } from '../src/services/content-import.js';
import type { ChatMemberChecker, MemberCheckResult } from '../src/telegram/member-checker.js';
import { signInitData } from '../src/telegram/init-data.js';

export const BOT_TOKEN = '123456789:TEST_TOKEN_for_unit_tests_only_xxxxxxxxx';
export const ADMIN_TG = 777000111;
export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef0123456789';

export class FakeChecker implements ChatMemberChecker {
  result: MemberCheckResult = { kind: 'ok', status: 'member' };
  calls = 0;
  async check(): Promise<MemberCheckResult> {
    this.calls++;
    return this.result;
  }
}

export function initData(userId: number, opts: { firstName?: string; authDate?: number; token?: string } = {}) {
  return signInitData(
    {
      query_id: 'AAH-test',
      user: JSON.stringify({ id: userId, first_name: opts.firstName ?? 'Кисуля', username: `u${userId}`, language_code: 'ru' }),
      auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
    },
    opts.token ?? BOT_TOKEN,
  );
}

export const auth = (userId: number) => ({ authorization: `tma ${initData(userId)}` });

/** Согласие на обработку ПДн — без него учётная запись не создаётся */
export async function consent(app: Awaited<ReturnType<typeof setup>>['app'], ...userIds: number[]) {
  for (const id of userIds) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/consent',
      headers: auth(id),
      payload: { version: CONSENT_VERSION, acceptPolicy: true, ageConfirmed: true },
    });
    if (r.statusCode !== 200) throw new Error(`consent failed: ${r.body}`);
  }
}

export async function setup(extraEnv: Record<string, string> = {}, sms?: import('../src/services/sms.js').SmsSender) {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    BOT_TOKEN,
    ADMIN_TELEGRAM_IDS: String(ADMIN_TG),
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    DEV_AUTH_BYPASS: 'false',
    ...extraEnv,
  });
  const checker = new FakeChecker();
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const { app, ctx } = await buildApp({ env, checker, logger: false, rng, sms });
  // Чистая БД для каждого файла тестов
  const tables = await ctx.db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
  );
  await ctx.db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seedDefaults(ctx.db);
  const content = JSON.parse(readFileSync(resolve(__dirname, '../../../content/abm/content.json'), 'utf8')) as ContentFile;
  await importContent(ctx.db, content);
  ctx.settings.invalidate();
  await ctx.subscription.syncFromEnv();
  return { app, ctx, checker };
}

export async function correctOptionId(ctx: Awaited<ReturnType<typeof setup>>['ctx'], questionId: string, correct = true) {
  const o = await ctx.db.answerOption.findFirstOrThrow({ where: { questionId, isCorrect: correct } });
  return o.id;
}
