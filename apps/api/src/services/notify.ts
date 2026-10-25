import type { Api } from 'grammy';
import { moscowDay } from '@zayush/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db.js';

/**
 * Уведомления через бота. Отправляются только тем, кто:
 *  1) запустил бота (/start) или разрешил боту писать (write access), и
 *  2) сам включил уведомления в настройках приложения.
 */
export class Notifier {
  constructor(
    private db: Db,
    private api: Api | null,
    private webAppUrl: string,
    private log?: FastifyBaseLogger,
  ) {}

  get enabled() {
    return !!this.api;
  }

  async send(userId: string, text: string): Promise<boolean> {
    if (!this.api) return false;
    const u = await this.db.user.findUnique({ where: { id: userId } });
    if (!u || !u.botCanWrite || !u.notificationsEnabled || u.isBlocked) return false;
    try {
      const isHttps = this.webAppUrl.startsWith('https://');
      await this.api.sendMessage(
        Number(u.telegramId),
        text,
        isHttps ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть Заюш ПДД', web_app: { url: this.webAppUrl } }]] } } : {},
      );
      return true;
    } catch (e) {
      const code = (e as { error_code?: number }).error_code;
      // 403 — пользователь заблокировал бота: больше не пишем
      if (code === 403) await this.db.user.update({ where: { id: userId }, data: { botCanWrite: false } });
      this.log?.warn({ userId, code }, 'notification failed');
      return false;
    }
  }

  /** Ежедневное напоминание тем, у кого есть серия, но сегодня ещё не было занятий */
  async sendDailyReminders(): Promise<number> {
    if (!this.api) return 0;
    const today = moscowDay();
    const users = await this.db.user.findMany({
      where: { botCanWrite: true, notificationsEnabled: true, isBlocked: false, NOT: { lastActiveDay: today } },
      select: { id: true, streakDays: true, firstName: true },
      take: 5000,
    });
    let sent = 0;
    for (const u of users) {
      const text =
        u.streakDays > 1
          ? `Кисуль, у тебя серия ${u.streakDays} дн. 🔥 Пара вопросиков — и она не сгорит 💗`
          : 'Заюш, твоя машинка заскучала 🐰 Решим сегодня пару билетиков?';
      if (await this.send(u.id, text)) sent++;
      await new Promise((r) => setTimeout(r, 40)); // мягко к лимитам Telegram
    }
    return sent;
  }
}

/** Простой планировщик: раз в минуту проверяет, не пора ли отправить напоминания */
export function startReminderJob(notifier: Notifier, hourMsk: number, log?: FastifyBaseLogger) {
  let lastRunDay = '';
  const timer = setInterval(async () => {
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(now));
    const day = moscowDay(now);
    if (hour === hourMsk && lastRunDay !== day) {
      lastRunDay = day;
      const n = await notifier.sendDailyReminders().catch(() => 0);
      log?.info({ sent: n }, 'daily reminders sent');
    }
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
