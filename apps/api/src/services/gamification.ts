import { ACHIEVEMENTS, ranksCrossed, type RankConfig, xpKeys } from '@zayush/shared';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * Начисление XP через журнал XpEvent.
 * INSERT ... ON CONFLICT DO NOTHING (createMany + skipDuplicates) не ломает транзакцию
 * при повторе и гарантирует, что одна и та же награда не будет выдана дважды.
 */
export async function awardXp(tx: Tx, userId: string, amount: number, reason: string, dedupeKey: string): Promise<number> {
  if (amount <= 0) return 0;
  const res = await tx.xpEvent.createMany({ data: [{ userId, amount, reason, dedupeKey }], skipDuplicates: true });
  if (res.count === 0) return 0;
  await tx.user.update({ where: { id: userId }, data: { xp: { increment: amount } } });
  return amount;
}

export interface UnlockedAchievement {
  code: string;
  title: string;
  xp: number;
}

/** Выдаёт достижение (идемпотентно) и начисляет его XP */
export async function unlockAchievement(tx: Tx, userId: string, code: string): Promise<UnlockedAchievement | null> {
  const def = ACHIEVEMENTS.find((a) => a.code === code);
  if (!def) return null;
  const ach = await tx.achievement.upsert({
    where: { code },
    create: { code, title: def.title, description: def.description, icon: def.icon, xpReward: def.xpReward },
    update: {},
  });
  const res = await tx.userAchievement.createMany({ data: [{ userId, achievementId: ach.id }], skipDuplicates: true });
  if (res.count === 0) return null;
  const xp = await awardXp(tx, userId, ach.xpReward, `achievement:${code}`, xpKeys.achievement(code));
  return { code, title: ach.title, xp };
}

/** Открывает награды рангов, пересечённых при переходе oldXp → newXp. Возвращает старший новый ранг. */
export async function applyRankUps(
  tx: Tx,
  userId: string,
  oldXp: number,
  newXp: number,
  ranks: RankConfig[],
): Promise<RankConfig | null> {
  const crossed = ranksCrossed(oldXp, newXp, ranks);
  if (!crossed.length) return null;
  const data = crossed.flatMap((r) => r.rewards.map((rewardCode) => ({ userId, rewardCode, source: `rank:${r.code}` })));
  if (data.length) await tx.userReward.createMany({ data, skipDuplicates: true });
  return crossed[crossed.length - 1];
}

/** Награды стартового ранга — выдаются при создании пользователя */
export async function grantStarterRewards(tx: Tx, userId: string, ranks: RankConfig[]) {
  const first = [...ranks].sort((a, b) => a.minXp - b.minXp)[0];
  if (!first) return;
  await tx.userReward.createMany({
    data: first.rewards.map((rewardCode) => ({ userId, rewardCode, source: `rank:${first.code}` })),
    skipDuplicates: true,
  });
}
