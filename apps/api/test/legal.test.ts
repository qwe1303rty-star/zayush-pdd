import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_VERSION, normalizeRuPhone, type ConsentStatusDTO } from '@zayush/shared';
import { loadEnv } from '../src/env.js';
import { runRetention } from '../src/services/retention.js';
import type { SmsSender } from '../src/services/sms.js';
import { auth, consent, setup } from './helpers.js';

class FakeSms implements SmsSender {
  name = 'fake';
  last: { phone: string; text: string } | null = null;
  async send(phone: string, text: string) {
    this.last = { phone, text };
  }
  code() {
    return this.last?.text.match(/\d{6}/)?.[0] ?? '';
  }
}

describe('152-ФЗ: согласие и удаление данных', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('без согласия учётная запись не создаётся, API отвечает CONSENT_REQUIRED', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8001) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('CONSENT_REQUIRED');
    expect(await t.ctx.db.user.count({ where: { telegramId: 8001n } })).toBe(0);
    const st = (await t.app.inject({ method: 'GET', url: '/api/consent', headers: auth(8001) })).json<ConsentStatusDTO>();
    expect(st.required).toBe(true);
    expect(st.version).toBe(CONSENT_VERSION);
    expect(st.ageRating).toBe('12+');
    expect(await t.ctx.db.user.count({ where: { telegramId: 8001n } })).toBe(0);
  });

  it('согласие без отметок отклоняется', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/consent',
      headers: auth(8001),
      payload: { version: CONSENT_VERSION, acceptPolicy: true, ageConfirmed: false },
    });
    expect(r.statusCode).toBe(400);
    const old = await t.app.inject({
      method: 'POST',
      url: '/api/consent',
      headers: auth(8001),
      payload: { version: '2000-01-01', acceptPolicy: true, ageConfirmed: true },
    });
    expect(old.statusCode).toBe(400);
  });

  it('после согласия — доступ открыт, в журнале обезличенная запись, username не хранится', async () => {
    await consent(t.app, 8001);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8001) });
    expect(me.statusCode).toBe(200);
    const u = await t.ctx.db.user.findUniqueOrThrow({ where: { telegramId: 8001n } });
    expect(u.consentVersion).toBe(CONSENT_VERSION);
    expect(Object.keys(u)).not.toContain('username');
    const log = await t.ctx.db.consentLog.findMany();
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe('GRANTED');
    expect(log[0].subjectHash).not.toContain('8001');
    expect(log[0].subjectHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('новая версия согласия требует подтверждения заново', async () => {
    await t.ctx.db.user.update({ where: { telegramId: 8001n }, data: { consentVersion: '2000-01-01' } });
    const r = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8001) });
    expect(r.json().error.code).toBe('CONSENT_REQUIRED');
    await consent(t.app, 8001);
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8001) })).statusCode).toBe(200);
  });

  it('удаление аккаунта стирает все данные и фиксирует отзыв согласия', async () => {
    const bad = await t.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(8001), payload: { confirm: 'yes' } });
    expect(bad.statusCode).toBe(400);
    const r = await t.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(8001), payload: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(await t.ctx.db.user.count({ where: { telegramId: 8001n } })).toBe(0);
    expect(await t.ctx.db.userReward.count()).toBe(0);
    const actions = (await t.ctx.db.consentLog.findMany({ orderBy: { createdAt: 'asc' } })).map((l) => l.action);
    expect(actions.at(-1)).toBe('WITHDRAWN');
    const again = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8001) });
    expect(again.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('документы доступны без входа: политика, согласие, соглашение, лицензии', async () => {
    for (const slug of ['privacy', 'consent', 'terms', 'licenses']) {
      const page = await t.app.inject({ method: 'GET', url: `/legal/${slug}` });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.body).toContain('12+');
      const api = await t.app.inject({ method: 'GET', url: `/api/legal/${slug}` });
      expect(api.statusCode).toBe(200);
    }
    const lic = (await t.app.inject({ method: 'GET', url: '/api/legal/licenses' })).json<{ html: string }>().html;
    expect(lic).toContain('Wikimedia Commons');
    expect(lic).toContain('CC BY-SA');
    expect((await t.app.inject({ method: 'GET', url: '/legal/nope' })).statusCode).toBe(404);
  });

  it('удаление неактивных аккаунтов по сроку хранения', async () => {
    await consent(t.app, 8002, 8003);
    await t.ctx.db.user.update({ where: { telegramId: 8002n }, data: { lastSeenAt: new Date(Date.now() - 1200 * 86400_000) } });
    const r = await runRetention(t.ctx.db, 1095);
    expect(r.users).toBe(1);
    expect(await t.ctx.db.user.count({ where: { telegramId: 8002n } })).toBe(0);
    expect(await t.ctx.db.user.count({ where: { telegramId: 8003n } })).toBe(1);
  });
});

describe('149-ФЗ: подтверждение российского номера', () => {
  const sms = new FakeSms();
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup({ AUTH_RU_PHONE_REQUIRED: 'true' }, sms);
    await consent(t.app, 8101);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('нормализация номера: только российские мобильные', () => {
    expect(normalizeRuPhone('+7 (912) 345-67-89')).toBe('79123456789');
    expect(normalizeRuPhone('8 912 345 67 89')).toBe('79123456789');
    expect(normalizeRuPhone('+380 50 123 45 67')).toBeNull();
    expect(normalizeRuPhone('+7 495 123-45-67')).toBeNull();
  });

  it('без подтверждения — PHONE_REQUIRED; иностранный номер не принимается', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8101) });
    expect(r.json().error.code).toBe('PHONE_REQUIRED');
    const bad = await t.app.inject({ method: 'POST', url: '/api/phone/start', headers: auth(8101), payload: { phone: '+44 7700 900123' } });
    expect(bad.statusCode).toBe(400);
  });

  it('код подтверждает номер; хранится только хэш', async () => {
    const s = await t.app.inject({ method: 'POST', url: '/api/phone/start', headers: auth(8101), payload: { phone: '+7 912 345-67-89' } });
    expect(s.statusCode).toBe(200);
    expect(sms.last?.phone).toBe('79123456789');
    const wrong = await t.app.inject({ method: 'POST', url: '/api/phone/verify', headers: auth(8101), payload: { code: '000000' === sms.code() ? '111111' : '000000' } });
    expect(wrong.statusCode).toBe(400);
    const ok = await t.app.inject({ method: 'POST', url: '/api/phone/verify', headers: auth(8101), payload: { code: sms.code() } });
    expect(ok.statusCode).toBe(200);
    const u = await t.ctx.db.user.findUniqueOrThrow({ where: { telegramId: 8101n } });
    expect(u.phoneVerifiedAt).not.toBeNull();
    expect(u.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(u, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('9123456789');
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(8101) })).statusCode).toBe(200);
  });
});

describe('конфигурация production', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x',
    BOT_TOKEN: '1:x',
    PD_HASH_SECRET: 'x'.repeat(40),
    LEGAL_OPERATOR_NAME: 'ИП Иванова Анна Сергеевна',
    LEGAL_OPERATOR_INN: '770000000000',
    LEGAL_CONTACT_EMAIL: 'privacy@example.ru',
  };
  it('без данных оператора ПДн запуск запрещён', () => {
    expect(() => loadEnv({ ...base, LEGAL_OPERATOR_INN: '' })).toThrow(/LEGAL_OPERATOR_INN/);
    expect(() => loadEnv({ ...base, PD_HASH_SECRET: 'short' })).toThrow(/PD_HASH_SECRET/);
    expect(() => loadEnv(base)).not.toThrow();
  });
  it('обязательная проверка телефона требует настроенного SMS-провайдера', () => {
    expect(() => loadEnv({ ...base, AUTH_RU_PHONE_REQUIRED: 'true' })).toThrow(/SMS/);
    expect(() => loadEnv({ ...base, AUTH_RU_PHONE_REQUIRED: 'true', SMS_PROVIDER: 'smsru', SMSRU_API_ID: 'abc' })).not.toThrow();
  });
});
