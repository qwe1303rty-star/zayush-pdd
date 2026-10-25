import {
  DEFAULT_RANKS,
  mergeXpConfig,
  type RankConfig,
  type VoiceOverrides,
  type XpConfig,
} from '@zayush/shared';
import type { Db } from '../db.js';

/** Настройки из БД с небольшим кэшем в памяти (сбрасывается при изменении через админку) */
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private ttlMs = 30_000;

  constructor(private db: Db) {}

  invalidate() {
    this.cache.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < this.ttlMs) return c.value as T | null;
    const row = await this.db.appSettings.findUnique({ where: { key } });
    const value = (row?.value ?? null) as T | null;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set(key: string, value: unknown) {
    await this.db.appSettings.upsert({
      where: { key },
      create: { key, value: value as object },
      update: { value: value as object },
    });
    this.cache.delete(key);
  }

  async xp(): Promise<XpConfig> {
    return mergeXpConfig(await this.get<Partial<XpConfig>>('xp'));
  }

  async texts(): Promise<VoiceOverrides> {
    return (await this.get<VoiceOverrides>('texts')) ?? {};
  }

  async ranks(): Promise<RankConfig[]> {
    const c = this.cache.get('__ranks');
    if (c && Date.now() - c.at < this.ttlMs) return c.value as RankConfig[];
    const rows = await this.db.rank.findMany({ orderBy: { minXp: 'asc' } });
    const ranks: RankConfig[] = rows.length
      ? rows.map((r) => ({
          code: r.code,
          title: r.title,
          minXp: r.minXp,
          tagline: r.tagline ?? '',
          image: r.image ?? '/brand/rank-r1.webp',
          rewards: r.rewards,
        }))
      : DEFAULT_RANKS;
    this.cache.set('__ranks', { value: ranks, at: Date.now() });
    return ranks;
  }
}
