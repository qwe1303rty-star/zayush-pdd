import {
  type AnswerRequest,
  type AnswerResultDTO,
  type ExplanationDTO,
  moscowDay,
  nextStreak,
  type QuestionDTO,
  type QuestionSetDTO,
  rankProgress,
  type StatsDTO,
  type TicketDTO,
  type TopicDTO,
  xpKeys,
} from '@zayush/shared';
import type { Db } from '../db.js';
import { errors } from '../errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { applyRankUps, awardXp, unlockAchievement, type UnlockedAchievement } from './gamification.js';
import type { SettingsService } from './settings.js';

type Tx = Prisma.TransactionClient;

export const questionInclude = {
  options: { orderBy: { sortOrder: 'asc' } },
  topic: true,
  ticket: true,
} satisfies Prisma.QuestionInclude;

export type QuestionFull = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;

export function toQuestionDTO(
  q: QuestionFull,
  ctx: { favorites: Set<string>; lastAnswers: Map<string, { optionId: string; isCorrect: boolean }> },
): QuestionDTO {
  return {
    id: q.id,
    externalId: q.externalId,
    text: q.text,
    scene: q.scene,
    hint: q.hint,
    imageUrl: q.imageUrl,
    imageAlt: q.imageAlt,
    isDemo: q.isDemo,
    // Признак правильного ответа клиенту не отдаётся
    options: q.options.map((o) => ({ id: o.id, label: o.label, text: o.text })),
    isFavorite: ctx.favorites.has(q.id),
    topic: { slug: q.topic.slug, title: q.topic.title },
    ticket: q.ticket ? { id: q.ticket.id, number: q.ticket.number } : null,
    lastAnswer: ctx.lastAnswers.get(q.id) ?? null,
  };
}

export function buildExplanation(q: Pick<QuestionFull, 'options' | 'explanation' | 'takeaway' | 'clauseRefs' | 'signRefs' | 'sourceUrl'>): ExplanationDTO {
  const correct = q.options.find((o) => o.isCorrect);
  if (!correct) throw new Error('У вопроса нет правильного ответа');
  return {
    correctOptionId: correct.id,
    explanation: q.explanation,
    takeaway: q.takeaway,
    clauseRefs: q.clauseRefs,
    signRefs: q.signRefs,
    whyWrong: q.options.filter((o) => !o.isCorrect && o.whyWrong).map((o) => ({ optionId: o.id, text: o.whyWrong! })),
    sourceUrl: q.sourceUrl,
  };
}

export class LearningService {
  constructor(
    private db: Db,
    private settings: SettingsService,
  ) {}

  private async userContext(userId: string, questionIds: string[]) {
    const [favs, answers] = await Promise.all([
      this.db.favoriteQuestion.findMany({ where: { userId, questionId: { in: questionIds } }, select: { questionId: true } }),
      this.db.userAnswer.findMany({
        where: { userId, questionId: { in: questionIds }, mode: { not: 'EXAM' } },
        orderBy: { createdAt: 'desc' },
        distinct: ['questionId'],
        select: { questionId: true, optionId: true, isCorrect: true },
      }),
    ]);
    return {
      favorites: new Set(favs.map((f) => f.questionId)),
      lastAnswers: new Map(answers.map((a) => [a.questionId, { optionId: a.optionId, isCorrect: a.isCorrect }])),
    };
  }

  async toDTOs(userId: string, questions: QuestionFull[]): Promise<QuestionDTO[]> {
    const ctx = await this.userContext(userId, questions.map((q) => q.id));
    return questions.map((q) => toQuestionDTO(q, ctx));
  }

  async topics(userId: string): Promise<TopicDTO[]> {
    const topics = await this.db.topic.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { questions: { where: { isPublished: true }, select: { id: true } } },
    });
    const progress = await this.db.userProgress.findMany({ where: { userId }, select: { questionId: true, lastCorrect: true } });
    const pm = new Map(progress.map((p) => [p.questionId, p.lastCorrect]));
    return topics
      .filter((t) => t.questions.length > 0)
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        description: t.description,
        total: t.questions.length,
        answered: t.questions.filter((q) => pm.has(q.id)).length,
        correct: t.questions.filter((q) => pm.get(q.id) === true).length,
      }));
  }

  async tickets(userId: string): Promise<TicketDTO[]> {
    const tickets = await this.db.ticket.findMany({
      where: { isPublished: true },
      orderBy: [{ setCode: 'asc' }, { number: 'asc' }],
      include: { questions: { where: { isPublished: true }, select: { id: true } } },
    });
    const progress = await this.db.userProgress.findMany({ where: { userId }, select: { questionId: true, lastCorrect: true } });
    const pm = new Map(progress.map((p) => [p.questionId, p.lastCorrect]));
    return tickets
      .filter((t) => t.questions.length > 0)
      .map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        isDemo: t.isDemo,
        total: t.questions.length,
        answered: t.questions.filter((q) => pm.has(q.id)).length,
        correct: t.questions.filter((q) => pm.get(q.id) === true).length,
      }));
  }

  async ticketSet(userId: string, ticketId: string): Promise<QuestionSetDTO> {
    const ticket = await this.db.ticket.findFirst({ where: { id: ticketId, isPublished: true } });
    if (!ticket) throw errors.notFound('Билет не найден');
    const qs = await this.db.question.findMany({
      where: { ticketId, isPublished: true },
      orderBy: { ticketPosition: 'asc' },
      include: questionInclude,
    });
    await this.db.user.update({ where: { id: userId }, data: { lastTicketId: ticketId } });
    return { title: ticket.title, kind: 'ticket', isDemo: ticket.isDemo, questions: await this.toDTOs(userId, qs) };
  }

  async topicSet(userId: string, slug: string): Promise<QuestionSetDTO> {
    const topic = await this.db.topic.findUnique({ where: { slug } });
    if (!topic) throw errors.notFound('Тема не найдена');
    const qs = await this.db.question.findMany({
      where: { topicId: topic.id, isPublished: true },
      orderBy: { externalId: 'asc' },
      include: questionInclude,
    });
    return { title: topic.title, kind: 'topic', isDemo: qs.some((q) => q.isDemo), questions: await this.toDTOs(userId, qs) };
  }

  async mistakesSet(userId: string): Promise<QuestionSetDTO> {
    const ms = await this.db.mistake.findMany({
      where: { userId, resolvedAt: null, question: { isPublished: true } },
      orderBy: { lastWrongAt: 'desc' },
      include: { question: { include: questionInclude } },
    });
    const qs = ms.map((m) => m.question);
    return { title: 'Мои ошибки', kind: 'mistakes', isDemo: qs.some((q) => q.isDemo), questions: await this.toDTOs(userId, qs) };
  }

  async favoritesSet(userId: string): Promise<QuestionSetDTO> {
    const fs = await this.db.favoriteQuestion.findMany({
      where: { userId, question: { isPublished: true } },
      orderBy: { createdAt: 'desc' },
      include: { question: { include: questionInclude } },
    });
    const qs = fs.map((f) => f.question);
    return { title: 'Избранное', kind: 'favorites', isDemo: qs.some((q) => q.isDemo), questions: await this.toDTOs(userId, qs) };
  }

  /** Ежедневная подборка: сначала ошибки, потом нерешённые, потом остальное — стабильно в течение дня */
  async dailySet(userId: string): Promise<QuestionSetDTO> {
    const xp = await this.settings.xp();
    const day = moscowDay();
    const all = await this.db.question.findMany({ where: { isPublished: true }, select: { id: true } });
    const [mistakes, progress] = await Promise.all([
      this.db.mistake.findMany({ where: { userId, resolvedAt: null }, select: { questionId: true } }),
      this.db.userProgress.findMany({ where: { userId }, select: { questionId: true } }),
    ]);
    const mset = new Set(mistakes.map((m) => m.questionId));
    const pset = new Set(progress.map((p) => p.questionId));
    const seed = hashString(`${userId}:${day}`);
    const score = (id: string) => (mset.has(id) ? 0 : pset.has(id) ? 2 : 1) * 1e9 + (hashString(id + seed) % 1e9);
    const ids = all.map((q) => q.id).sort((a, b) => score(a) - score(b)).slice(0, xp.dailyGoal);
    const qs = await this.db.question.findMany({ where: { id: { in: ids } }, include: questionInclude });
    qs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { title: 'Ежедневное задание', kind: 'daily', isDemo: qs.some((q) => q.isDemo), questions: await this.toDTOs(userId, qs) };
  }

  async setFavorite(userId: string, questionId: string, favorite: boolean) {
    const q = await this.db.question.findFirst({ where: { id: questionId, isPublished: true }, select: { id: true } });
    if (!q) throw errors.notFound('Вопрос не найден');
    if (favorite) {
      await this.db.favoriteQuestion.createMany({ data: [{ userId, questionId }], skipDuplicates: true });
    } else {
      await this.db.favoriteQuestion.deleteMany({ where: { userId, questionId } });
    }
    return { favorite };
  }

  /**
   * Проверка ответа. Правильность определяется ТОЛЬКО по данным БД.
   * Повторная отправка с тем же clientAttemptId возвращает сохранённый результат без новых наград.
   */
  async answer(userId: string, req: AnswerRequest): Promise<AnswerResultDTO> {
    const existing = await this.db.userAnswer.findUnique({
      where: { userId_clientAttemptId: { userId, clientAttemptId: req.clientAttemptId } },
    });
    if (existing) return this.replay(userId, existing);

    const question = await this.db.question.findFirst({
      where: { id: req.questionId, isPublished: true },
      include: questionInclude,
    });
    if (!question) throw errors.notFound('Вопрос не найден');
    const option = question.options.find((o) => o.id === req.optionId);
    if (!option) throw errors.badRequest('Такого варианта ответа нет');
    const isCorrect = option.isCorrect;

    const [xpCfg, ranks] = await Promise.all([this.settings.xp(), this.settings.ranks()]);
    const day = moscowDay();

    try {
      const result = await this.db.$transaction(async (tx) => {
        const userBefore = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        let xpAwarded = 0;
        const unlocked: UnlockedAchievement[] = [];

        // 1. Сохраняем ответ
        const ua = await tx.userAnswer.create({
          data: {
            userId,
            questionId: question.id,
            optionId: option.id,
            isCorrect,
            mode: req.mode,
            clientAttemptId: req.clientAttemptId,
          },
        });

        // 2. Прогресс по вопросу
        await tx.userProgress.upsert({
          where: { userId_questionId: { userId, questionId: question.id } },
          create: { userId, questionId: question.id, attempts: 1, correctCount: isCorrect ? 1 : 0, lastCorrect: isCorrect },
          update: { attempts: { increment: 1 }, correctCount: { increment: isCorrect ? 1 : 0 }, lastCorrect: isCorrect },
        });

        // 3. Ошибки
        const mistake = await tx.mistake.findUnique({ where: { userId_questionId: { userId, questionId: question.id } } });
        if (!isCorrect) {
          await tx.mistake.upsert({
            where: { userId_questionId: { userId, questionId: question.id } },
            create: { userId, questionId: question.id },
            update: { count: { increment: 1 }, lastWrongAt: new Date(), resolvedAt: null },
          });
        } else if (mistake && !mistake.resolvedAt) {
          await tx.mistake.update({ where: { id: mistake.id }, data: { resolvedAt: new Date() } });
          if (req.mode === 'MISTAKES') {
            xpAwarded += await awardXp(tx, userId, xpCfg.mistakeFixed, 'mistake-fixed', xpKeys.mistakeFixed(question.id));
          }
        }

        // 4. XP за первый правильный ответ на вопрос (один раз навсегда)
        if (isCorrect) {
          xpAwarded += await awardXp(tx, userId, xpCfg.firstCorrect, 'first-correct', xpKeys.firstCorrect(question.id));
        }

        // 5. Ежедневное задание и серия дней
        const daily = await tx.dailyProgress.upsert({
          where: { userId_day: { userId, day } },
          create: { userId, day, answered: 1, correct: isCorrect ? 1 : 0 },
          update: { answered: { increment: 1 }, correct: { increment: isCorrect ? 1 : 0 } },
        });
        let dailyCompleted = false;
        if (!daily.challengeDone && daily.answered >= xpCfg.dailyGoal) {
          await tx.dailyProgress.update({ where: { id: daily.id }, data: { challengeDone: true } });
          xpAwarded += await awardXp(tx, userId, xpCfg.dailyChallenge, 'daily', xpKeys.daily(day));
          dailyCompleted = true;
        }
        const streak = nextStreak(userBefore.lastActiveDay, day, userBefore.streakDays);
        await tx.user.update({
          where: { id: userId },
          data: { streakDays: streak, bestStreak: Math.max(streak, userBefore.bestStreak), lastActiveDay: day },
        });

        // 6. Завершение билета
        let ticketCompleted = false;
        const ticketId = req.ticketId && question.ticketId === req.ticketId ? req.ticketId : null;
        if (ticketId) {
          const ticketQs = await tx.question.findMany({ where: { ticketId, isPublished: true }, select: { id: true } });
          const prog = await tx.userProgress.findMany({
            where: { userId, questionId: { in: ticketQs.map((t) => t.id) } },
            select: { lastCorrect: true },
          });
          if (prog.length === ticketQs.length && ticketQs.length > 0) {
            const got = await awardXp(tx, userId, xpCfg.ticketCompleted, 'ticket', xpKeys.ticketCompleted(ticketId));
            xpAwarded += got;
            ticketCompleted = got > 0;
            if (prog.every((p) => p.lastCorrect)) {
              const a = await unlockAchievement(tx, userId, 'ticket-clean');
              if (a) unlocked.push(a);
            }
          }
        }

        // 7. Достижения
        if (isCorrect) {
          const correctCount = await tx.userProgress.count({ where: { userId, correctCount: { gt: 0 } } });
          if (correctCount >= 1) {
            const a = await unlockAchievement(tx, userId, 'first-steps');
            if (a) unlocked.push(a);
          }
          if (correctCount >= 10) {
            const a = await unlockAchievement(tx, userId, 'ten-correct');
            if (a) unlocked.push(a);
          }
          const fixed = await tx.mistake.count({ where: { userId, resolvedAt: { not: null } } });
          if (fixed >= 5) {
            const a = await unlockAchievement(tx, userId, 'mistake-fixer');
            if (a) unlocked.push(a);
          }
        }
        if (streak >= 3) {
          const a = await unlockAchievement(tx, userId, 'streak-3');
          if (a) unlocked.push(a);
        }
        xpAwarded += unlocked.reduce((s, a) => s + a.xp, 0);

        // 8. Ранги
        const userAfter = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } });
        const rankUp = await applyRankUps(tx, userId, userBefore.xp, userAfter.xp, ranks);

        await tx.userAnswer.update({ where: { id: ua.id }, data: { xpAwarded } });

        return {
          isCorrect,
          xpAwarded,
          totalXp: userAfter.xp,
          rankUp,
          achievementsUnlocked: unlocked.map((a) => ({ code: a.code, title: a.title })),
          dailyCompleted,
          ticketCompleted,
          explanation: buildExplanation(question),
          duplicate: false,
        } satisfies AnswerResultDTO;
      });
      return result;
    } catch (err) {
      // Гонка двух одинаковых запросов: второй упадёт на уникальном ключе — отдаём сохранённый результат
      if ((err as { code?: string }).code === 'P2002') {
        const again = await this.db.userAnswer.findUnique({
          where: { userId_clientAttemptId: { userId, clientAttemptId: req.clientAttemptId } },
        });
        if (again) return this.replay(userId, again);
      }
      throw err;
    }
  }

  private async replay(userId: string, ua: { questionId: string; isCorrect: boolean; xpAwarded: number }): Promise<AnswerResultDTO> {
    const question = await this.db.question.findUniqueOrThrow({ where: { id: ua.questionId }, include: questionInclude });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } });
    return {
      isCorrect: ua.isCorrect,
      xpAwarded: ua.xpAwarded,
      totalXp: user.xp,
      rankUp: null,
      achievementsUnlocked: [],
      dailyCompleted: false,
      ticketCompleted: false,
      explanation: buildExplanation(question),
      duplicate: true,
    };
  }

  async stats(userId: string): Promise<StatsDTO> {
    const [answeredQuestions, correctQuestions, lastCorrect, totalAnswers, correctAnswers, totalQuestions, openMistakes, favorites, examsPassed, examsTotal] =
      await Promise.all([
        this.db.userProgress.count({ where: { userId } }),
        this.db.userProgress.count({ where: { userId, correctCount: { gt: 0 } } }),
        this.db.userProgress.count({ where: { userId, lastCorrect: true } }),
        this.db.userAnswer.count({ where: { userId } }),
        this.db.userAnswer.count({ where: { userId, isCorrect: true } }),
        this.db.question.count({ where: { isPublished: true } }),
        this.db.mistake.count({ where: { userId, resolvedAt: null } }),
        this.db.favoriteQuestion.count({ where: { userId } }),
        this.db.examAttempt.count({ where: { userId, status: 'PASSED' } }),
        this.db.examAttempt.count({ where: { userId, status: { not: 'IN_PROGRESS' } } }),
      ]);
    return {
      answeredQuestions,
      correctQuestions,
      totalAnswers,
      accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
      totalQuestions,
      openMistakes,
      favorites,
      examsPassed,
      examsTotal,
      readiness: totalQuestions ? Math.round((lastCorrect / totalQuestions) * 100) : 0,
    };
  }

  async rankInfo(xp: number) {
    const ranks = await this.settings.ranks();
    const p = rankProgress(xp, ranks);
    return { current: p.current, next: p.next, ratio: p.ratio, xpForNext: p.xpForNext };
  }

  async resetProgress(userId: string) {
    // Сбрасывается учебная статистика. XP, ранги, награды и журнал начислений сохраняются,
    // поэтому повторное прохождение не даёт повторных наград.
    await this.db.$transaction([
      this.db.userAnswer.deleteMany({ where: { userId, mode: { not: 'EXAM' } } }),
      this.db.userProgress.deleteMany({ where: { userId } }),
      this.db.mistake.deleteMany({ where: { userId } }),
      this.db.user.update({ where: { id: userId }, data: { lastTicketId: null } }),
    ]);
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
