import { describe, expect, it } from 'vitest';
import {
  buildExamItems,
  evaluateExam,
  examConfigByCode,
  ExamPoolError,
  pickExtras,
  type ExamItem,
} from './exam.js';
import { DEFAULT_RANKS, rankForXp, rankProgress, ranksCrossed } from './ranks.js';
import { rewardByCode } from './rewards.js';
import { isMemberStatus, parseSubscriptionEnv } from './subscription.js';
import { dayDiff, mergeXpConfig, moscowDay, nextStreak } from './xp.js';
import { say } from './voice.js';

const cfg = examConfigByCode('gibdd-abm')!;

function pool(): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (let b = 1; b <= 4; b++) m.set(b, Array.from({ length: 12 }, (_, i) => `b${b}-q${i}`));
  return m;
}
const seeded = () => {
  let s = 42;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

describe('экзамен: параметры ГИБДД', () => {
  it('20 вопросов, 4 блока по 5, 20 минут, максимум 2 ошибки, +5 за ошибку', () => {
    expect(cfg.blocks * cfg.questionsPerBlock).toBe(20);
    expect(cfg.minutes).toBe(20);
    expect(cfg.maxErrors).toBe(2);
    expect(cfg.extraPerError).toBe(5);
    expect(cfg.extraMinutesPerError).toBe(5);
  });

  it('собирает 5 уникальных вопросов из каждого блока', () => {
    const items = buildExamItems(cfg, pool(), seeded());
    expect(items).toHaveLength(20);
    expect(new Set(items.map((i) => i.questionId)).size).toBe(20);
    for (let b = 1; b <= 4; b++) expect(items.filter((i) => i.block === b)).toHaveLength(5);
  });

  it('падает, если вопросов в блоке меньше, чем нужно с учётом доп. вопросов', () => {
    const p = pool();
    p.set(3, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(() => buildExamItems(cfg, p)).toThrow(ExamPoolError);
  });
});

describe('экзамен: оценка', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const deadline = new Date('2026-10-21T10:20:00Z');
  const items = buildExamItems(cfg, pool(), seeded());
  const allCorrect = () => new Map(items.map((i) => [i.questionId, true] as const));

  it('без ошибок — сдан', () => {
    const r = evaluateExam(cfg, items, allCorrect(), now, deadline);
    expect(r.status).toBe('PASSED');
    expect(r.correct).toBe(20);
  });

  it('одна ошибка — нужны доп. вопросы этого блока, экзамен продолжается', () => {
    const a = allCorrect();
    const wrongItem = items.find((i) => i.block === 2)!;
    a.set(wrongItem.questionId, false);
    const r = evaluateExam(cfg, items, a, now, deadline);
    expect(r.status).toBe('IN_PROGRESS');
    expect(r.addExtrasForBlocks).toEqual([2]);
  });

  it('после добавления доп. вопросов и верных ответов — сдан', () => {
    const a = allCorrect();
    const wrongItem = items.find((i) => i.block === 2)!;
    a.set(wrongItem.questionId, false);
    const used = new Set(items.map((i) => i.questionId));
    const extras = pickExtras(cfg, 2, pool(), used, seeded());
    expect(extras).toHaveLength(5);
    expect(extras.every((e) => !used.has(e.questionId) && e.extra && e.block === 2)).toBe(true);
    const all: ExamItem[] = [...items, ...extras];
    for (const e of extras) a.set(e.questionId, true);
    expect(evaluateExam(cfg, all, a, now, deadline).status).toBe('PASSED');
  });

  it('ошибка в доп. вопросах — не сдан', () => {
    const a = allCorrect();
    const wrongItem = items.find((i) => i.block === 1)!;
    a.set(wrongItem.questionId, false);
    const extras = pickExtras(cfg, 1, pool(), new Set(items.map((i) => i.questionId)));
    a.set(extras[0].questionId, false);
    const r = evaluateExam(cfg, [...items, ...extras], a, now, deadline);
    expect(r.status).toBe('FAILED');
    expect(r.reason).toBe('extra-error');
  });

  it('две ошибки в одном блоке — не сдан', () => {
    const a = allCorrect();
    const b3 = items.filter((i) => i.block === 3);
    a.set(b3[0].questionId, false);
    a.set(b3[1].questionId, false);
    expect(evaluateExam(cfg, items, a, now, deadline).reason).toBe('two-in-block');
  });

  it('две ошибки в разных блоках — доп. вопросы по обоим блокам', () => {
    const a = allCorrect();
    a.set(items.find((i) => i.block === 1)!.questionId, false);
    a.set(items.find((i) => i.block === 4)!.questionId, false);
    const r = evaluateExam(cfg, items, a, now, deadline);
    expect(r.status).toBe('IN_PROGRESS');
    expect(r.addExtrasForBlocks).toEqual([1, 4]);
  });

  it('три ошибки в разных блоках — не сдан', () => {
    const a = allCorrect();
    for (const b of [1, 2, 3]) a.set(items.find((i) => i.block === b)!.questionId, false);
    expect(evaluateExam(cfg, items, a, now, deadline).reason).toBe('too-many-errors');
  });

  it('время вышло до конца — EXPIRED', () => {
    const a = new Map<string, boolean>([[items[0].questionId, true]]);
    const late = new Date(deadline.getTime() + 1000);
    expect(evaluateExam(cfg, items, a, late, deadline).status).toBe('EXPIRED');
  });
});

describe('ранги и XP', () => {
  it('ранг по XP и пересечение порогов', () => {
    expect(rankForXp(0).code).toBe('novichok');
    expect(rankForXp(99).code).toBe('novichok');
    expect(rankForXp(100).code).toBe('uchenitsa');
    expect(ranksCrossed(95, 105).map((r) => r.code)).toEqual(['uchenitsa']);
    expect(ranksCrossed(105, 110)).toEqual([]);
    const p = rankProgress(150);
    expect(p.next?.code).toBe('stilnaya');
    expect(p.ratio).toBeCloseTo(50 / 200);
    expect(rankProgress(999999).next).toBeNull();
  });

  it('ранги совпадают с картинками и листом «Ранги за XP»', () => {
    expect(DEFAULT_RANKS.map((r) => [r.title, r.minXp, r.image])).toEqual([
      ['Новичок', 0, '/brand/rank-r1.webp'],
      ['Ученица', 100, '/brand/rank-r2.webp'],
      ['Стильная', 300, '/brand/rank-r3.webp'],
      ['Мечтательница', 600, '/brand/rank-r4.webp'],
      ['Принцесса', 1000, '/brand/rank-r5.webp'],
      ['Королева', 1500, '/brand/rank-r6.webp'],
      ['Топ-модель', 2500, '/brand/rank-r7.webp'],
      ['Звезда дорог', 4000, '/brand/rank-r8.webp'],
    ]);
  });

  it('каждая награда ранга есть в каталоге гаража', () => {
    for (const r of DEFAULT_RANKS) for (const code of r.rewards) expect(rewardByCode(code), code).toBeTruthy();
  });

  it('баланс XP: переопределение с валидацией', () => {
    const c = mergeXpConfig({ firstCorrect: 12, dailyGoal: -1 as number, examPassed: Number.NaN });
    expect(c.firstCorrect).toBe(12);
    expect(c.dailyGoal).toBe(10);
    expect(c.examPassed).toBe(50);
  });

  it('серия дней', () => {
    expect(nextStreak(null, '2026-10-21', 0)).toBe(1);
    expect(nextStreak('2026-10-20', '2026-10-21', 4)).toBe(5);
    expect(nextStreak('2026-10-21', '2026-10-21', 4)).toBe(4);
    expect(nextStreak('2026-10-18', '2026-10-21', 4)).toBe(1);
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('день по Москве', () => {
    expect(moscowDay(new Date('2026-10-21T21:30:00Z'))).toBe('2026-10-22');
  });
});

describe('конфигурация подписки', () => {
  it('пустые списки и выключенный флаг — проверка не нужна', () => {
    expect(parseSubscriptionEnv({}).enabled).toBe(false);
    expect(parseSubscriptionEnv({ REQUIRE_SUBSCRIPTION: 'false', REQUIRED_CHANNELS: '@zayush_channel' }).enabled).toBe(false);
  });

  it('флаг включён, но источников нет — проверка не включается', () => {
    expect(parseSubscriptionEnv({ REQUIRE_SUBSCRIPTION: 'true' }).enabled).toBe(false);
  });

  it('разбирает каналы и группы, подставляет ссылку для публичных', () => {
    const c = parseSubscriptionEnv({
      REQUIRE_SUBSCRIPTION: 'true',
      REQUIRED_CHANNELS: '@zayush_channel||Канал Заюша',
      REQUIRED_GROUPS: '-1001234567890|https://t.me/+AbCdEf123|Чат',
    });
    expect(c.enabled).toBe(true);
    expect(c.sources).toHaveLength(2);
    expect(c.sources[0]).toMatchObject({ kind: 'CHANNEL', inviteUrl: 'https://t.me/zayush_channel' });
    expect(c.sources[1]).toMatchObject({ kind: 'GROUP', chatId: '-1001234567890' });
  });

  it('закрытый чат без ссылки-приглашения — ошибка конфигурации, не угадываем ссылку', () => {
    const c = parseSubscriptionEnv({ REQUIRE_SUBSCRIPTION: 'true', REQUIRED_GROUPS: '-1001234567890' });
    expect(c.sources).toHaveLength(0);
    expect(c.errors[0]).toMatch(/ссылка/);
  });

  it('статусы участника', () => {
    expect(isMemberStatus('member')).toBe(true);
    expect(isMemberStatus('administrator')).toBe(true);
    expect(isMemberStatus('creator')).toBe(true);
    expect(isMemberStatus('restricted', true)).toBe(true);
    expect(isMemberStatus('restricted', false)).toBe(false);
    expect(isMemberStatus('left')).toBe(false);
    expect(isMemberStatus('kicked')).toBe(false);
  });
});

describe('голос', () => {
  it('подставляет переменные', () => {
    expect(say('daily.title', { seed: 0, vars: { goal: 10, xp: 20 } })).toBe('Реши 10 вопросов и получи бонус +20 💗');
  });
});
