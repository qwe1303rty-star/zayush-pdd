import type { FastifyBaseLogger } from 'fastify';

/** Отправка кода подтверждения по SMS. Номер передаётся провайдеру только для отправки и у нас не сохраняется. */
export interface SmsSender {
  name: string;
  send(phone: string, text: string): Promise<void>;
}

/** Только для разработки: код пишется в лог сервера. В production запрещён проверкой env. */
export class ConsoleSms implements SmsSender {
  name = 'console';
  constructor(private log?: FastifyBaseLogger) {}
  async send(phone: string, text: string) {
    this.log?.warn({ phoneTail: phone.slice(-2) }, `[DEV SMS] ${text}`);
  }
}

/** sms.ru — российский SMS-провайдер (https://sms.ru/api/send) */
export class SmsRu implements SmsSender {
  name = 'smsru';
  constructor(private apiId: string) {}
  async send(phone: string, text: string) {
    const body = new URLSearchParams({ api_id: this.apiId, to: phone, msg: text, json: '1' });
    const res = await fetch('https://sms.ru/sms/send', { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    const j = (await res.json().catch(() => null)) as { status?: string; sms?: Record<string, { status?: string }> } | null;
    const per = j?.sms ? Object.values(j.sms)[0] : undefined;
    if (!res.ok || j?.status !== 'OK' || per?.status !== 'OK') throw new Error('SMS не отправлено');
  }
}
