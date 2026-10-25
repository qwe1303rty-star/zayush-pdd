import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_TOKEN, consent, setup } from './helpers.js';

const admin = { 'x-admin-token': ADMIN_TOKEN };

describe('аналитика посещаемости (ACTIVITY_TRACKING)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup({ ACTIVITY_TRACKING: 'true', ACTIVITY_PING_MIN: '5', ACTIVITY_ONLINE_MIN: '10' });
    await consent(t.app, 9100, 9101);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('пинг пишется при запросе и троттлится в памяти', async () => {
    for (let i = 0; i < 3; i++) await t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `tma ${(await import('./helpers.js')).initData(9100)}` } });
    await new Promise((r) => setTimeout(r, 50));
    const n = await t.ctx.db.activityPing.count({ where: { user: { telegramId: 9100n } } });
    expect(n).toBe(1); // три запроса — один пинг из-за троттлинга
  });

  it('онлайн и пик в /stats', async () => {
    await t.ctx.db.activityPing.create({ data: { userId: (await t.ctx.db.user.findFirstOrThrow({ where: { telegramId: 9101n } })).id } });
    const s = (await t.app.inject({ method: 'GET', url: '/api/admin/stats', headers: admin })).json();
    expect(s.activityTracking).toBe(true);
    expect(s.onlineNow).toBeGreaterThanOrEqual(2);
    expect(s.peakDay.users).toBeGreaterThanOrEqual(1);
    expect(typeof s.newToday).toBe('number');
  });

  it('тайм-серия для диаграммы', async () => {
    const r = (await t.app.inject({ method: 'GET', url: '/api/admin/activity?range=day', headers: admin })).json();
    expect(r.unit).toBe('hour');
    expect(Array.isArray(r.points)).toBe(true);
    expect(r.points.reduce((a: number, p: { users: number }) => a + p.users, 0)).toBeGreaterThan(0);
  });

  it('список пользователей с онлайном и поиском', async () => {
    const r = (await t.app.inject({ method: 'GET', url: '/api/admin/users?sort=recent', headers: admin })).json();
    expect(r.total).toBeGreaterThanOrEqual(2);
    expect(r.users[0]).toHaveProperty('online');
    const byId = (await t.app.inject({ method: 'GET', url: '/api/admin/users?search=9100', headers: admin })).json();
    expect(byId.users.some((u: { telegramId: string }) => u.telegramId === '9100')).toBe(true);
  });

  it('карточка пользователя: сессии и активность', async () => {
    const u = await t.ctx.db.user.findFirstOrThrow({ where: { telegramId: 9100n } });
    const r = (await t.app.inject({ method: 'GET', url: `/api/admin/users/${u.id}?bucket=hour`, headers: admin })).json();
    expect(r.user.telegramId).toBe('9100');
    expect(r.sessionsTotal).toBeGreaterThanOrEqual(1);
    expect(r.totalMinutes).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.series)).toBe(true);
  });

  it('аналитика выключена по умолчанию', async () => {
    const t2 = await setup();
    const s = (await t2.app.inject({ method: 'GET', url: '/api/admin/stats', headers: admin })).json();
    expect(s.activityTracking).toBe(false);
    expect(s.onlineNow).toBeNull();
    const a = await t2.app.inject({ method: 'GET', url: '/api/admin/activity', headers: admin });
    expect(a.statusCode).toBe(400);
    await t2.app.close();
  });
});
