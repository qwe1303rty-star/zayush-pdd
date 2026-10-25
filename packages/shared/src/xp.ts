/**
 * Баланс XP. Значения по умолчанию; переопределяются через AppSettings["xp"] в админке.
 * XP начисляется ТОЛЬКО на сервере, через журнал XpEvent с уникальным dedupeKey,
 * поэтому повторный ответ на один и тот же вопрос не даёт бесконечных наград.
 */
export interface XpConfig {
  /** Первый правильный ответ на вопрос (один раз на вопрос) */
  firstCorrect: number;
  /** Исправление ошибки в режиме «Мои ошибки» (один раз на вопрос) */
  mistakeFixed: number;
  /** Билет пройден до конца (один раз на билет) */
  ticketCompleted: number;
  /** Ежедневное задание выполнено (один раз в день) */
  dailyChallenge: number;
  /** Сколько вопросов нужно решить для ежедневного задания */
  dailyGoal: number;
  /** Экзамен сдан (не чаще одного раза в день) */
  examPassed: number;
}

export const DEFAULT_XP: XpConfig = {
  firstCorrect: 10,
  mistakeFixed: 5,
  ticketCompleted: 15,
  dailyChallenge: 20,
  dailyGoal: 10,
  examPassed: 50,
};

export function mergeXpConfig(override: Partial<XpConfig> | null | undefined): XpConfig {
  const merged = { ...DEFAULT_XP };
  if (!override) return merged;
  for (const key of Object.keys(DEFAULT_XP) as (keyof XpConfig)[]) {
    const v = override[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000) merged[key] = Math.round(v);
  }
  return merged;
}

export const xpKeys = {
  firstCorrect: (questionId: string) => `first-correct:${questionId}`,
  mistakeFixed: (questionId: string) => `mistake-fixed:${questionId}`,
  ticketCompleted: (ticketId: string) => `ticket:${ticketId}`,
  daily: (day: string) => `daily:${day}`,
  examPassed: (day: string) => `exam-passed:${day}`,
  achievement: (code: string) => `achievement:${code}`,
};

/** Дата в часовом поясе Москвы, формат YYYY-MM-DD */
export function moscowDay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts; // en-CA даёт YYYY-MM-DD
}

/** Разница в днях между двумя датами YYYY-MM-DD */
export function dayDiff(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Новая серия дней после активности сегодня */
export function nextStreak(lastActiveDay: string | null, today: string, currentStreak: number): number {
  if (!lastActiveDay) return 1;
  const diff = dayDiff(lastActiveDay, today);
  if (diff <= 0) return Math.max(1, currentStreak);
  if (diff === 1) return currentStreak + 1;
  return 1;
}

/** Склонение слова «балл» для интерфейса (в коде величина по-прежнему называется xp). */
export function pointsWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'баллов';
  if (b === 1) return 'балл';
  if (b >= 2 && b <= 4) return 'балла';
  return 'баллов';
}

/** «5 баллов», «1 балл», «22 балла» */
export function formatPoints(n: number): string {
  return `${n} ${pointsWord(n)}`;
}
