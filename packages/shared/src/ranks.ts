/**
 * Ранги — исключительно игровая метафора прогресса в учёбе.
 * Они не связаны с внешностью пользователя и не оценивают её.
 * Значения по умолчанию; владелец может переопределить их в админке (таблица Rank).
 */
export interface RankConfig {
  code: string;
  title: string;
  minXp: number;
  tagline: string;
  /** Путь к картинке ранга в apps/web/public */
  image: string;
  /** Коды наград из REWARDS, которые открывает ранг */
  rewards: string[];
}

/** Коды рангов первой версии — для автоматического обновления уже созданных баз */
export const LEGACY_RANK_CODES = ['novice', 'princess', 'signs-queen', 'tickets-queen', 'runway-star', 'top-model', 'empress'];

/**
 * Названия совпадают с надписями на картинках рангов (apps/web/public/brand/rank-r1…r8),
 * пороги XP — с листом «Ранги за XP». Если меняете название в админке — замените и картинку.
 */
export const DEFAULT_RANKS: RankConfig[] = [
  { code: 'novichok', title: 'Новичок', minXp: 0, tagline: 'Только начинаешь путь. Всё получится!', image: '/brand/rank-r1.webp', rewards: ['car-pink', 'sticker-joy'] },
  { code: 'uchenitsa', title: 'Ученица', minXp: 100, tagline: 'Первые билеты позади — так держать!', image: '/brand/rank-r2.webp', rewards: ['item-crown', 'sticker-hello'] },
  { code: 'stilnaya', title: 'Стильная', minXp: 300, tagline: 'Знаки читаешь как любимый журнал.', image: '/brand/rank-r3.webp', rewards: ['item-glasses', 'car-lilac', 'sticker-wink'] },
  { code: 'mechtatelnitsa', title: 'Мечтательница', minXp: 600, tagline: 'Права уже совсем близко — мечтай и учись!', image: '/brand/rank-r4.webp', rewards: ['car-sky', 'sticker-tender'] },
  { code: 'printsessa', title: 'Принцесса', minXp: 1000, tagline: 'Ты уже не просто новичок — ты настоящая принцесса ПДД!', image: '/brand/rank-r5.webp', rewards: ['item-bag', 'car-mint', 'sticker-smile'] },
  { code: 'koroleva', title: 'Королева', minXp: 1500, tagline: 'Билеты? Разнесла, даже не вспотела.', image: '/brand/rank-r6.webp', rewards: ['item-plate', 'car-white', 'sticker-laugh'] },
  { code: 'model-vs', title: 'Топ-модель', minXp: 2500, tagline: 'Дорога — твой подиум, правила — твой стиль.', image: '/brand/rank-r7.webp', rewards: ['item-spoiler', 'car-black', 'sticker-magic'] },
  { code: 'zvezda-dorog', title: 'Звезда дорог', minXp: 4000, tagline: 'Ты знаешь всё. ПДД — твоя суперсила.', image: '/brand/rank-r8.webp', rewards: ['item-wheel', 'car-gold', 'sticker-wow'] },
];

export function sortRanks(ranks: RankConfig[]): RankConfig[] {
  return [...ranks].sort((a, b) => a.minXp - b.minXp);
}

export function rankForXp(xp: number, ranks: RankConfig[] = DEFAULT_RANKS): RankConfig {
  const sorted = sortRanks(ranks);
  let current = sorted[0];
  for (const r of sorted) if (xp >= r.minXp) current = r;
  return current;
}

export function nextRank(xp: number, ranks: RankConfig[] = DEFAULT_RANKS): RankConfig | null {
  return sortRanks(ranks).find((r) => r.minXp > xp) ?? null;
}

/** Ранги, которые пользователь пересёк при переходе oldXp → newXp (для анимации повышения) */
export function ranksCrossed(oldXp: number, newXp: number, ranks: RankConfig[] = DEFAULT_RANKS): RankConfig[] {
  return sortRanks(ranks).filter((r) => r.minXp > oldXp && r.minXp <= newXp);
}

export interface RankProgress {
  current: RankConfig;
  next: RankConfig | null;
  /** 0..1 — прогресс до следующего ранга */
  ratio: number;
  xpIntoRank: number;
  xpForNext: number | null;
}

export function rankProgress(xp: number, ranks: RankConfig[] = DEFAULT_RANKS): RankProgress {
  const current = rankForXp(xp, ranks);
  const next = nextRank(xp, ranks);
  if (!next) return { current, next, ratio: 1, xpIntoRank: xp - current.minXp, xpForNext: null };
  const span = next.minXp - current.minXp;
  return {
    current,
    next,
    ratio: span > 0 ? Math.min(1, (xp - current.minXp) / span) : 1,
    xpIntoRank: xp - current.minXp,
    xpForNext: next.minXp - xp,
  };
}
