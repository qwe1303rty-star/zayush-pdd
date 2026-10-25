import type { Db } from '../db.js';
import type { Env } from '../env.js';

/**
 * Запись отметок присутствия пользователей для аналитики посещаемости в админ-панели.
 * Включается ACTIVITY_TRACKING. Чтобы не нагружать БД, на пользователя пишется не чаще
 * одного раза в ACTIVITY_PING_MIN минут — порог держится в памяти процесса.
 */
export class ActivityService {
  private last = new Map<string, number>();

  constructor(
    private db: Db,
    private env: Env,
  ) {}

  get enabled() {
    return this.env.activityTracking;
  }

  /** Отмечает присутствие. Не блокирует запрос: ошибки гасятся. */
  ping(userId: string) {
    if (!this.enabled) return;
    const now = Date.now();
    const prev = this.last.get(userId);
    if (prev && now - prev < this.env.ACTIVITY_PING_MIN * 60_000) return;
    this.last.set(userId, now);
    if (this.last.size > 20_000) this.gcMemory(now);
    this.db.activityPing.create({ data: { userId } }).catch(() => {});
  }

  private gcMemory(now: number) {
    const ttl = this.env.ACTIVITY_PING_MIN * 60_000;
    for (const [k, v] of this.last) if (now - v > ttl) this.last.delete(k);
  }
}
