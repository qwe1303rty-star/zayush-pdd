import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Сроки хранения (152-ФЗ, ч. 7 ст. 5): удаляем данные, которые больше не нужны.
 *  - аккаунты без входа дольше inactiveDays — вместе со всем прогрессом (каскадно);
 *  - просроченные коды подтверждения телефона;
 *  - журнал согласий — через 3 года после отзыва согласия.
 */
export async function runRetention(db: Db, inactiveDays: number, activityDays = 0, now = new Date()) {
  const res = { users: 0, codes: 0, consentLogs: 0, pings: 0 };
  if (inactiveDays > 0) {
    const r = await db.user.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - inactiveDays * DAY) } } });
    res.users = r.count;
  }
  if (activityDays > 0)
    res.pings = (await db.activityPing.deleteMany({ where: { at: { lt: new Date(now.getTime() - activityDays * DAY) } } })).count;
  res.codes = (await db.phoneCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } })).count;
  const old = new Date(now.getTime() - 3 * 365 * DAY);
  const withdrawn = await db.consentLog.findMany({ where: { action: 'WITHDRAWN', createdAt: { lt: old } }, select: { subjectHash: true } });
  if (withdrawn.length) {
    res.consentLogs = (
      await db.consentLog.deleteMany({ where: { subjectHash: { in: withdrawn.map((w) => w.subjectHash) }, createdAt: { lt: old } } })
    ).count;
  }
  return res;
}

export function startRetentionJob(db: Db, inactiveDays: number, activityDays: number, log?: FastifyBaseLogger) {
  const tick = () =>
    runRetention(db, inactiveDays, activityDays)
      .then((r) => log?.info(r, 'retention cleanup'))
      .catch((e) => log?.error({ err: (e as Error).message }, 'retention failed'));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, DAY);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
