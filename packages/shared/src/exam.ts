/**
 * Движок экзамена. Чистые функции без доступа к БД — покрыты тестами.
 *
 * Конфигурация "gibdd-abm" воспроизводит порядок теоретического экзамена ГИБДД
 * (постановление Правительства РФ от 24.10.2014 № 1097, приказ МВД от 20.02.2021 № 80):
 *  - 20 вопросов, 4 тематических блока по 5 вопросов, 20 минут;
 *  - допускается не более 2 ошибок, и только в разных блоках;
 *  - за каждую ошибку — 5 дополнительных вопросов из того же блока и +5 минут;
 *  - любая ошибка в дополнительных вопросах — экзамен не сдан.
 * Перед публичным запуском сверяйте параметры с актуальной редакцией регламента.
 * Результат в приложении — тренировка и не гарантирует сдачу официального экзамена.
 */
export interface ExamConfig {
  code: string;
  title: string;
  description: string;
  blocks: number;
  questionsPerBlock: number;
  minutes: number;
  maxErrors: number;
  extraPerError: number;
  extraMinutesPerError: number;
  /** Работает на демонстрационной базе вопросов */
  demo: boolean;
}

export const EXAM_CONFIGS: ExamConfig[] = [
  {
    code: 'gibdd-abm',
    title: 'Экзамен как в ГИБДД',
    description: '20 вопросов, 20 минут, без подсказок. Ошибка → +5 вопросов и +5 минут.',
    blocks: 4,
    questionsPerBlock: 5,
    minutes: 20,
    maxErrors: 2,
    extraPerError: 5,
    extraMinutesPerError: 5,
    demo: false,
  },
  {
    code: 'mini',
    title: 'Мини-экзамен',
    description: '8 вопросов, 8 минут — быстрая проверка по тем же правилам.',
    blocks: 4,
    questionsPerBlock: 2,
    minutes: 8,
    maxErrors: 2,
    extraPerError: 2,
    extraMinutesPerError: 2,
    demo: false,
  },
];

export function examConfigByCode(code: string): ExamConfig | undefined {
  return EXAM_CONFIGS.find((c) => c.code === code);
}

export interface ExamItem {
  questionId: string;
  /** Номер блока 1..N */
  block: number;
  /** Дополнительный вопрос */
  extra: boolean;
}

/** Минимум вопросов в каждом блоке, чтобы экзамен можно было провести с доп. вопросами */
export function requiredPerBlock(cfg: ExamConfig): number {
  return cfg.questionsPerBlock + cfg.extraPerError;
}

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Собирает основную часть экзамена.
 * pool: блок → список id вопросов этого блока.
 */
export function buildExamItems(cfg: ExamConfig, pool: Map<number, string[]>, rng: Rng = Math.random): ExamItem[] {
  const items: ExamItem[] = [];
  for (let b = 1; b <= cfg.blocks; b++) {
    const ids = pool.get(b) ?? [];
    if (ids.length < requiredPerBlock(cfg)) {
      throw new ExamPoolError(b, ids.length, requiredPerBlock(cfg));
    }
    for (const id of shuffle(ids, rng).slice(0, cfg.questionsPerBlock)) {
      items.push({ questionId: id, block: b, extra: false });
    }
  }
  return items;
}

export class ExamPoolError extends Error {
  constructor(public block: number, public have: number, public need: number) {
    super(`Недостаточно вопросов в блоке ${block}: есть ${have}, нужно ${need}`);
  }
}

export type ExamStatus = 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'EXPIRED';

export interface ExamEvaluation {
  status: ExamStatus;
  reason?: 'too-many-errors' | 'two-in-block' | 'extra-error' | 'timeout';
  /** Блоки, для которых нужно добавить дополнительные вопросы прямо сейчас */
  addExtrasForBlocks: number[];
  answered: number;
  total: number;
  correct: number;
  wrong: number;
}

/**
 * Оценивает текущее состояние попытки.
 * answers: questionId → верно/неверно (только отвеченные).
 */
export function evaluateExam(
  cfg: ExamConfig,
  items: ExamItem[],
  answers: Map<string, boolean>,
  now: Date,
  deadline: Date,
): ExamEvaluation {
  const main = items.filter((i) => !i.extra);
  const extras = items.filter((i) => i.extra);
  let correct = 0;
  let wrong = 0;
  const wrongByBlock = new Map<number, number>();
  let extraWrong = false;
  for (const it of items) {
    const a = answers.get(it.questionId);
    if (a === undefined) continue;
    if (a) correct++;
    else {
      wrong++;
      if (it.extra) extraWrong = true;
      else wrongByBlock.set(it.block, (wrongByBlock.get(it.block) ?? 0) + 1);
    }
  }
  const answered = correct + wrong;
  const base = { answered, total: items.length, correct, wrong, addExtrasForBlocks: [] as number[] };
  const mainWrong = [...wrongByBlock.values()].reduce((s, v) => s + v, 0);

  if ([...wrongByBlock.values()].some((v) => v >= 2)) return { ...base, status: 'FAILED', reason: 'two-in-block' };
  if (mainWrong > cfg.maxErrors) return { ...base, status: 'FAILED', reason: 'too-many-errors' };
  if (extraWrong) return { ...base, status: 'FAILED', reason: 'extra-error' };

  const mainDone = main.every((i) => answers.has(i.questionId));
  const allDone = items.every((i) => answers.has(i.questionId));

  if (now.getTime() > deadline.getTime() && !allDone) return { ...base, status: 'EXPIRED', reason: 'timeout' };

  if (mainDone) {
    const blocksWithExtras = new Set(extras.map((e) => e.block));
    const need = [...wrongByBlock.keys()].filter((b) => !blocksWithExtras.has(b)).sort();
    if (need.length) return { ...base, status: 'IN_PROGRESS', addExtrasForBlocks: need };
  }
  if (allDone) return { ...base, status: 'PASSED' };
  return { ...base, status: 'IN_PROGRESS' };
}

/** Подбирает дополнительные вопросы для блока, исключая уже использованные */
export function pickExtras(
  cfg: ExamConfig,
  block: number,
  pool: Map<number, string[]>,
  used: Set<string>,
  rng: Rng = Math.random,
): ExamItem[] {
  const candidates = (pool.get(block) ?? []).filter((id) => !used.has(id));
  return shuffle(candidates, rng)
    .slice(0, cfg.extraPerError)
    .map((questionId) => ({ questionId, block, extra: true }));
}

export const EXAM_REASON_TEXT: Record<NonNullable<ExamEvaluation['reason']>, string> = {
  'too-many-errors': 'Больше двух ошибок в основной части',
  'two-in-block': 'Две ошибки в одном тематическом блоке',
  'extra-error': 'Ошибка в дополнительных вопросах',
  timeout: 'Время вышло',
};
