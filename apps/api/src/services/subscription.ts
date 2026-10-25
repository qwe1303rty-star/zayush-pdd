import { type GateStatusDTO, isMemberStatus, type SubscriptionSource } from '@zayush/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db.js';
import { errors } from '../errors.js';
import type { RequiredSubscription } from '../generated/prisma/client.js';
import type { ChatMemberChecker } from '../telegram/member-checker.js';
import type { SettingsService } from './settings.js';

export interface SubscriptionOptions {
  envEnabled: boolean;
  envSources: SubscriptionSource[];
  ttlMinutes: number;
  graceHours: number;
}

type SourceResult = { id: string; ok: boolean | null; kind: 'ok' | 'not-member' | 'config-error' | 'unavailable' };

/**
 * Опциональная обязательная подписка на каналы/чаты.
 *  - Источники и флаг хранятся в БД (управляются из админки); при старте из .env
 *    добавляются отсутствующие источники и начальное значение флага.
 *  - Если флаг выключен или нет активных источников — проверка не выполняется вообще.
 *  - Подписка проверяется ТОЛЬКО на сервере через getChatMember; клиенту не доверяем.
 *  - Успешная проверка кэшируется на SUBSCRIPTION_TTL_MIN, затем перепроверяется.
 *  - При временной недоступности Telegram пускаем тех, кто успешно проходил проверку
 *    за последние SUBSCRIPTION_GRACE_HOURS; остальным — понятная ошибка и повтор.
 */
export class SubscriptionService {
  private lastLiveCheck = new Map<string, number>();

  constructor(
    private db: Db,
    private settings: SettingsService,
    private checker: ChatMemberChecker,
    private opts: SubscriptionOptions,
    private log?: FastifyBaseLogger,
  ) {}

  /** Синхронизация источников из .env в БД (только добавление отсутствующих) */
  async syncFromEnv() {
    for (const [i, s] of this.opts.envSources.entries()) {
      await this.db.requiredSubscription.upsert({
        where: { kind_chatId: { kind: s.kind, chatId: s.chatId } },
        create: { kind: s.kind, chatId: s.chatId, inviteUrl: s.inviteUrl, title: s.title, sortOrder: i },
        update: {},
      });
    }
    const existing = await this.settings.get<{ enabled: boolean }>('subscription');
    if (!existing) await this.settings.set('subscription', { enabled: this.opts.envEnabled });
  }

  async isEnabled(): Promise<boolean> {
    const s = await this.settings.get<{ enabled: boolean }>('subscription');
    const flag = s ? s.enabled === true : this.opts.envEnabled;
    if (!flag) return false;
    return (await this.activeSources()).length > 0;
  }

  async activeSources(): Promise<RequiredSubscription[]> {
    return this.db.requiredSubscription.findMany({ where: { isActive: true }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] });
  }

  private publicSources(sources: RequiredSubscription[], results?: SourceResult[]): GateStatusDTO['sources'] {
    return sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      url: s.inviteUrl,
      ok: results?.find((r) => r.id === s.id)?.ok ?? null,
    }));
  }

  /** Статус без живого запроса в Telegram (по последней проверке) */
  async status(userId: string): Promise<GateStatusDTO> {
    if (!(await this.isEnabled())) return { required: false, passed: true, sources: [], state: 'not-required' };
    const sources = await this.activeSources();
    const last = await this.db.subscriptionCheck.findFirst({ where: { userId }, orderBy: { checkedAt: 'desc' } });
    if (last?.passed && last.validUntil > new Date()) {
      return { required: true, passed: true, sources: this.publicSources(sources, last.details as SourceResult[]), state: 'passed' };
    }
    return {
      required: true,
      passed: false,
      sources: this.publicSources(sources, last ? (last.details as SourceResult[]) : undefined),
      state: last ? 'missing' : 'not-checked',
    };
  }

  /** Живая проверка через Telegram Bot API */
  async check(userId: string, telegramId: bigint): Promise<GateStatusDTO> {
    if (!(await this.isEnabled())) return { required: false, passed: true, sources: [], state: 'not-required' };
    const sources = await this.activeSources();
    const results: SourceResult[] = [];
    for (const s of sources) {
      const r = await this.checker.check(s.chatId, Number(telegramId));
      if (r.kind === 'ok') results.push({ id: s.id, ok: isMemberStatus(r.status, r.isMember), kind: 'ok' });
      else if (r.kind === 'not-member') results.push({ id: s.id, ok: false, kind: 'not-member' });
      else {
        // Внутренние детали (chatId, текст ошибки Telegram) пишем только в лог сервера
        this.log?.warn({ sourceId: s.id, kind: r.kind, description: r.description }, 'subscription check failed');
        results.push({ id: s.id, ok: null, kind: r.kind });
      }
    }
    this.lastLiveCheck.set(userId, Date.now());

    const unavailable = results.some((r) => r.ok === null);
    const passed = !unavailable && results.every((r) => r.ok === true);
    const missing = results.some((r) => r.ok === false);

    if (unavailable && !missing) {
      // Не записываем провал: временная ошибка не должна блокировать навсегда
      return { required: true, passed: false, sources: this.publicSources(sources, results), state: 'unavailable' };
    }
    await this.db.subscriptionCheck.create({
      data: {
        userId,
        passed,
        details: results as unknown as object,
        validUntil: new Date(Date.now() + this.opts.ttlMinutes * 60_000),
      },
    });
    return { required: true, passed, sources: this.publicSources(sources, results), state: passed ? 'passed' : 'missing' };
  }

  /**
   * Охрана защищённых операций. Бросает SUBSCRIPTION_REQUIRED / SUBSCRIPTION_CHECK_UNAVAILABLE.
   */
  async assertAccess(userId: string, telegramId: bigint): Promise<void> {
    if (!(await this.isEnabled())) return;
    const last = await this.db.subscriptionCheck.findFirst({ where: { userId }, orderBy: { checkedAt: 'desc' } });
    if (last?.passed && last.validUntil > new Date()) return;
    if (!last) throw errors.subscriptionRequired();

    // Кэш истёк: перепроверяем (не чаще раза в 10 секунд на пользователя)
    const recent = this.lastLiveCheck.get(userId);
    if (recent && Date.now() - recent < 10_000 && !last.passed) throw errors.subscriptionRequired();
    const res = await this.check(userId, telegramId);
    if (res.passed) return;
    if (res.state === 'unavailable') {
      const graceFrom = new Date(Date.now() - this.opts.graceHours * 3_600_000);
      const recentOk = await this.db.subscriptionCheck.findFirst({ where: { userId, passed: true, checkedAt: { gte: graceFrom } } });
      if (recentOk) return;
      throw errors.subscriptionUnavailable();
    }
    throw errors.subscriptionRequired();
  }
}
