import {
  ACHIEVEMENTS,
  type GarageDTO,
  type MeDTO,
  moscowDay,
  REWARDS,
  rewardByCode,
} from '@zayush/shared';
import type { Db } from '../db.js';
import { errors } from '../errors.js';
import type { User } from '../generated/prisma/client.js';
import { unlockAchievement } from './gamification.js';
import type { LearningService } from './learning.js';
import type { SettingsService } from './settings.js';
import type { SubscriptionService } from './subscription.js';

export class ProfileService {
  constructor(
    private db: Db,
    private learning: LearningService,
    private settings: SettingsService,
    private subscription: SubscriptionService,
  ) {}

  async me(user: User, isAdmin: boolean): Promise<MeDTO> {
    const [stats, rank, xpCfg, gate] = await Promise.all([
      this.learning.stats(user.id),
      this.learning.rankInfo(user.xp),
      this.settings.xp(),
      this.subscription.status(user.id),
    ]);
    const day = moscowDay();
    const daily = await this.db.dailyProgress.findUnique({ where: { userId_day: { userId: user.id, day } } });
    let lastTicket: MeDTO['lastTicket'] = null;
    if (user.lastTicketId) {
      const t = await this.db.ticket.findUnique({
        where: { id: user.lastTicketId },
        include: { questions: { where: { isPublished: true }, select: { id: true } } },
      });
      if (t) {
        const answered = await this.db.userProgress.count({ where: { userId: user.id, questionId: { in: t.questions.map((q) => q.id) } } });
        lastTicket = { id: t.id, number: t.number, title: t.title, answered, total: t.questions.length };
      }
    }
    const demoCount = await this.db.question.count({ where: { isPublished: true, isDemo: true } });
    // Серия «сгорает», если вчера не было занятий
    const streakAlive = user.lastActiveDay && (user.lastActiveDay === day || dayBefore(day) === user.lastActiveDay);
    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        xp: user.xp,
        streakDays: streakAlive ? user.streakDays : 0,
        bestStreak: user.bestStreak,
        equippedCar: user.equippedCar,
        notificationsEnabled: user.notificationsEnabled,
        isAdmin,
        isNew: stats.totalAnswers === 0,
      },
      rank,
      stats,
      daily: {
        day,
        answered: daily?.answered ?? 0,
        goal: xpCfg.dailyGoal,
        done: daily?.challengeDone ?? false,
        xp: xpCfg.dailyChallenge,
      },
      lastTicket,
      access: { required: gate.required, passed: gate.passed },
      isDemoContent: demoCount > 0,
    };
  }

  async garage(user: User): Promise<GarageDTO> {
    const [ranks, rewards, achDefs, userAch] = await Promise.all([
      this.settings.ranks(),
      this.db.userReward.findMany({ where: { userId: user.id } }),
      this.db.achievement.findMany(),
      this.db.userAchievement.findMany({ where: { userId: user.id }, include: { achievement: true } }),
    ]);
    const unlocked = new Set(rewards.map((r) => r.rewardCode));
    const rankOf = new Map<string, string>();
    for (const r of ranks) for (const code of r.rewards) if (!rankOf.has(code)) rankOf.set(code, r.title);
    const achMap = new Map(userAch.map((u) => [u.achievement.code, u.unlockedAt]));
    const defs = ACHIEVEMENTS.map((d) => {
      const db = achDefs.find((a) => a.code === d.code);
      return { ...d, title: db?.title ?? d.title, description: db?.description ?? d.description, xpReward: db?.xpReward ?? d.xpReward };
    });
    return {
      equippedCar: user.equippedCar,
      rewards: REWARDS.map((r) => ({
        code: r.code,
        kind: r.kind,
        title: r.title,
        image: r.image,
        unlocked: unlocked.has(r.code),
        unlockRank: rankOf.get(r.code) ?? null,
      })),
      achievements: defs.map((d) => ({
        code: d.code,
        title: d.title,
        description: d.description,
        icon: d.icon,
        xpReward: d.xpReward,
        unlockedAt: achMap.get(d.code)?.toISOString() ?? null,
      })),
      ranks: ranks.map((r) => ({ ...r, reached: user.xp >= r.minXp })),
    };
  }

  async equipCar(user: User, code: string) {
    const def = rewardByCode(code);
    if (!def || def.kind !== 'car') throw errors.badRequest('Это не машина');
    const owned = await this.db.userReward.findUnique({ where: { userId_rewardCode: { userId: user.id, rewardCode: code } } });
    if (!owned) throw errors.forbidden();
    await this.db.user.update({ where: { id: user.id }, data: { equippedCar: code } });
    return { equippedCar: code };
  }

  async checkSignsFan(userId: string) {
    const n = await this.db.favoriteSign.count({ where: { userId } });
    if (n >= 5) await this.db.$transaction((tx) => unlockAchievement(tx, userId, 'signs-fan'));
  }
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
