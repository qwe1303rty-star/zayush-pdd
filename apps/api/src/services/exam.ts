import {
  buildExamItems,
  EXAM_CONFIGS,
  EXAM_REASON_TEXT,
  type ExamConfig,
  type ExamConfigDTO,
  examConfigByCode,
  type ExamItem,
  ExamPoolError,
  type ExamResultReviewDTO,
  type ExamStateDTO,
  evaluateExam,
  moscowDay,
  pickExtras,
  xpKeys,
} from '@zayush/shared';
import type { Db } from '../db.js';
import { errors } from '../errors.js';
import type { ExamAttempt } from '../generated/prisma/client.js';
import { applyRankUps, awardXp, unlockAchievement } from './gamification.js';
import { buildExplanation, type LearningService, questionInclude } from './learning.js';
import type { SettingsService } from './settings.js';

export class ExamService {
  constructor(
    private db: Db,
    private learning: LearningService,
    private settings: SettingsService,
    private rng: () => number = Math.random,
  ) {}

  /** Пул вопросов по тематическим блокам экзамена */
  private async pool(): Promise<{ pool: Map<number, string[]>; isDemo: boolean }> {
    const qs = await this.db.question.findMany({
      where: { isPublished: true, OR: [{ examBlock: { not: null } }, { topic: { examBlock: { not: null } } }] },
      select: { id: true, isDemo: true, examBlock: true, topic: { select: { examBlock: true } } },
    });
    const pool = new Map<number, string[]>();
    for (const q of qs) {
      // Блок вопроса: собственный (позиция в официальном билете) или блок темы
      const b = (q.examBlock ?? q.topic.examBlock)!;
      pool.set(b, [...(pool.get(b) ?? []), q.id]);
    }
    return { pool, isDemo: qs.some((q) => q.isDemo) };
  }

  async configs(): Promise<ExamConfigDTO[]> {
    const { pool } = await this.pool();
    return EXAM_CONFIGS.map((c) => {
      let reason: string | null = null;
      for (let b = 1; b <= c.blocks; b++) {
        const have = pool.get(b)?.length ?? 0;
        const need = c.questionsPerBlock + c.extraPerError;
        if (have < need) {
          reason = `Нужно минимум ${need} вопросов в блоке ${b}, сейчас ${have}. Загрузите билеты.`;
          break;
        }
      }
      return {
        code: c.code,
        title: c.title,
        description: c.description,
        questions: c.blocks * c.questionsPerBlock,
        minutes: c.minutes,
        maxErrors: c.maxErrors,
        available: !reason,
        unavailableReason: reason,
        demo: c.demo,
      };
    });
  }

  private cfg(code: string): ExamConfig {
    const c = examConfigByCode(code);
    if (!c) throw errors.badRequest('Неизвестный режим экзамена');
    return c;
  }

  async start(userId: string, examCode: string): Promise<ExamStateDTO> {
    const cfg = this.cfg(examCode);
    const active = await this.db.examAttempt.findFirst({ where: { userId, status: 'IN_PROGRESS' }, orderBy: { startedAt: 'desc' } });
    if (active) {
      const refreshed = await this.refresh(active);
      if (refreshed.status === 'IN_PROGRESS') return this.state(userId, refreshed);
    }
    const { pool } = await this.pool();
    let items: ExamItem[];
    try {
      items = buildExamItems(cfg, pool, this.rng);
    } catch (e) {
      if (e instanceof ExamPoolError) throw errors.conflict('EXAM_POOL_TOO_SMALL', e.message);
      throw e;
    }
    const now = new Date();
    const attempt = await this.db.examAttempt.create({
      data: {
        userId,
        examCode: cfg.code,
        items: items as unknown as object,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + cfg.minutes * 60_000),
      },
    });
    return this.state(userId, attempt);
  }

  private async getOwned(userId: string, attemptId: string) {
    const a = await this.db.examAttempt.findFirst({ where: { id: attemptId, userId } });
    if (!a) throw errors.notFound('Попытка не найдена');
    return a;
  }

  async get(userId: string, attemptId: string): Promise<ExamStateDTO> {
    const a = await this.refresh(await this.getOwned(userId, attemptId));
    return this.state(userId, a);
  }

  async active(userId: string): Promise<ExamStateDTO | null> {
    const a = await this.db.examAttempt.findFirst({ where: { userId, status: 'IN_PROGRESS' }, orderBy: { startedAt: 'desc' } });
    if (!a) return null;
    const r = await this.refresh(a);
    return r.status === 'IN_PROGRESS' ? this.state(userId, r) : null;
  }

  /** Проверяет истечение времени */
  private async refresh(a: ExamAttempt): Promise<ExamAttempt> {
    if (a.status !== 'IN_PROGRESS') return a;
    const cfg = this.cfg(a.examCode);
    const answers = await this.answersMap(a.id);
    const ev = evaluateExam(cfg, a.items as unknown as ExamItem[], answers, new Date(), a.deadlineAt);
    if (ev.status === 'EXPIRED') {
      return this.db.examAttempt.update({
        where: { id: a.id },
        data: { status: 'EXPIRED', finishedAt: new Date(), resultReason: ev.reason, correctCount: ev.correct, wrongCount: ev.wrong },
      });
    }
    return a;
  }

  private async answersMap(attemptId: string) {
    const rows = await this.db.userAnswer.findMany({ where: { examAttemptId: attemptId }, select: { questionId: true, isCorrect: true } });
    return new Map(rows.map((r) => [r.questionId, r.isCorrect]));
  }

  async answer(userId: string, attemptId: string, questionId: string, optionId: string): Promise<ExamStateDTO> {
    const attempt = await this.refresh(await this.getOwned(userId, attemptId));
    if (attempt.status !== 'IN_PROGRESS') throw errors.conflict('EXAM_FINISHED', 'Экзамен уже завершён');
    const cfg = this.cfg(attempt.examCode);
    const items = attempt.items as unknown as ExamItem[];
    if (!items.some((i) => i.questionId === questionId)) throw errors.badRequest('Этого вопроса нет в экзамене');

    const prev = await this.db.userAnswer.findFirst({ where: { examAttemptId: attemptId, questionId } });
    if (prev) {
      // Повторная отправка: тот же вариант — идемпотентно, другой — отказ (ответ в экзамене не меняется)
      if (prev.optionId !== optionId) throw errors.conflict('ALREADY_ANSWERED', 'Ответ на этот вопрос уже зафиксирован');
      return this.state(userId, attempt);
    }

    const question = await this.db.question.findUniqueOrThrow({ where: { id: questionId }, include: { options: true } });
    const option = question.options.find((o) => o.id === optionId);
    if (!option) throw errors.badRequest('Такого варианта ответа нет');

    const [xpCfg, ranks] = await Promise.all([this.settings.xp(), this.settings.ranks()]);

    try {
      const updated = await this.db.$transaction(async (tx) => {
        await tx.userAnswer.create({
          data: {
            userId,
            questionId,
            optionId,
            isCorrect: option.isCorrect,
            mode: 'EXAM',
            examAttemptId: attemptId,
            clientAttemptId: `exam:${attemptId}:${questionId}`,
          },
        });
        await tx.userProgress.upsert({
          where: { userId_questionId: { userId, questionId } },
          create: { userId, questionId, attempts: 1, correctCount: option.isCorrect ? 1 : 0, lastCorrect: option.isCorrect },
          update: { attempts: { increment: 1 }, correctCount: { increment: option.isCorrect ? 1 : 0 }, lastCorrect: option.isCorrect },
        });
        if (!option.isCorrect) {
          await tx.mistake.upsert({
            where: { userId_questionId: { userId, questionId } },
            create: { userId, questionId },
            update: { count: { increment: 1 }, lastWrongAt: new Date(), resolvedAt: null },
          });
        }

        const rows = await tx.userAnswer.findMany({ where: { examAttemptId: attemptId }, select: { questionId: true, isCorrect: true } });
        const answers = new Map(rows.map((r) => [r.questionId, r.isCorrect]));
        let curItems = items;
        let deadline = attempt.deadlineAt;
        let ev = evaluateExam(cfg, curItems, answers, new Date(), deadline);

        if (ev.addExtrasForBlocks.length) {
          const { pool } = await this.pool();
          const used = new Set(curItems.map((i) => i.questionId));
          for (const b of ev.addExtrasForBlocks) {
            const extras = pickExtras(cfg, b, pool, used, this.rng);
            extras.forEach((e) => used.add(e.questionId));
            curItems = [...curItems, ...extras];
          }
          deadline = new Date(deadline.getTime() + ev.addExtrasForBlocks.length * cfg.extraMinutesPerError * 60_000);
          ev = evaluateExam(cfg, curItems, answers, new Date(), deadline);
        }

        const finished = ev.status !== 'IN_PROGRESS';
        const a = await tx.examAttempt.update({
          where: { id: attemptId },
          data: {
            items: curItems as unknown as object,
            deadlineAt: deadline,
            status: ev.status,
            correctCount: ev.correct,
            wrongCount: ev.wrong,
            resultReason: ev.reason ?? null,
            finishedAt: finished ? new Date() : null,
          },
        });

        if (ev.status === 'PASSED') {
          const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } });
          await awardXp(tx, userId, xpCfg.examPassed, 'exam-passed', xpKeys.examPassed(moscowDay()));
          await unlockAchievement(tx, userId, 'exam-passed');
          const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } });
          await applyRankUps(tx, userId, before.xp, after.xp, ranks);
        }
        return a;
      });
      return this.state(userId, updated);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const a = await this.getOwned(userId, attemptId);
        return this.state(userId, a);
      }
      throw err;
    }
  }

  /** Досрочное завершение: неотвеченные вопросы считаются ошибками */
  async finish(userId: string, attemptId: string): Promise<ExamStateDTO> {
    const attempt = await this.refresh(await this.getOwned(userId, attemptId));
    if (attempt.status !== 'IN_PROGRESS') return this.state(userId, attempt);
    const answers = await this.answersMap(attemptId);
    const items = attempt.items as unknown as ExamItem[];
    const unanswered = items.filter((i) => !answers.has(i.questionId)).length;
    const a = await this.db.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        resultReason: 'too-many-errors',
        correctCount: [...answers.values()].filter(Boolean).length,
        wrongCount: [...answers.values()].filter((v) => !v).length + unanswered,
      },
    });
    return this.state(userId, a);
  }

  async history(userId: string) {
    const rows = await this.db.examAttempt.findMany({
      where: { userId, status: { not: 'IN_PROGRESS' } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => ({
      id: r.id,
      examCode: r.examCode,
      title: examConfigByCode(r.examCode)?.title ?? r.examCode,
      status: r.status,
      correct: r.correctCount,
      wrong: r.wrongCount,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      durationSec: r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) : null,
      reason: r.resultReason ? EXAM_REASON_TEXT[r.resultReason as keyof typeof EXAM_REASON_TEXT] ?? null : null,
    }));
  }

  async review(userId: string, attemptId: string): Promise<ExamResultReviewDTO[]> {
    const a = await this.refresh(await this.getOwned(userId, attemptId));
    if (a.status === 'IN_PROGRESS') throw errors.conflict('EXAM_IN_PROGRESS', 'Разбор доступен после завершения экзамена');
    const items = a.items as unknown as ExamItem[];
    const answers = await this.db.userAnswer.findMany({ where: { examAttemptId: a.id } });
    const am = new Map(answers.map((x) => [x.questionId, x]));
    const qs = await this.db.question.findMany({ where: { id: { in: items.map((i) => i.questionId) } }, include: questionInclude });
    const qm = new Map(qs.map((q) => [q.id, q]));
    return items
      .filter((i) => qm.has(i.questionId))
      .map((i) => {
        const q = qm.get(i.questionId)!;
        const ans = am.get(i.questionId);
        return {
          questionId: q.id,
          text: q.officialText ?? q.text,
          imageUrl: q.imageUrl,
          chosenOptionId: ans?.optionId ?? null,
          isCorrect: ans ? ans.isCorrect : null,
          options: q.options.map((o) => ({ id: o.id, label: o.label, text: o.text })),
          explanation: buildExplanation(q),
        };
      });
  }

  private async state(userId: string, a: ExamAttempt): Promise<ExamStateDTO> {
    const items = a.items as unknown as ExamItem[];
    const answered = await this.answersMap(a.id);
    const qs = await this.db.question.findMany({ where: { id: { in: items.map((i) => i.questionId) } }, include: questionInclude });
    qs.sort((x, y) => items.findIndex((i) => i.questionId === x.id) - items.findIndex((i) => i.questionId === y.id));
    const dtos = await this.learning.toDTOs(userId, qs);
    // В экзамене не подсказываем прошлые ответы
    for (const d of dtos) {
      d.lastAnswer = null;
      d.hint = null;
      // В экзамене — официальная формулировка, без шуток: ничто не мешает концентрации
      const src = qs.find((x) => x.id === d.id);
      if (src?.officialText) d.text = src.officialText;
      d.scene = null;
    }
    const xpEvent =
      a.status === 'PASSED'
        ? await this.db.xpEvent.findFirst({ where: { userId, reason: 'exam-passed', createdAt: { gte: a.startedAt } } })
        : null;
    const cfg = examConfigByCode(a.examCode);
    return {
      id: a.id,
      examCode: a.examCode,
      title: cfg?.title ?? a.examCode,
      status: a.status,
      startedAt: a.startedAt.toISOString(),
      deadlineAt: a.deadlineAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      serverNow: new Date().toISOString(),
      items: items.map((i) => ({ ...i, answered: answered.has(i.questionId) })),
      questions: dtos,
      // Правильность раскрывается только после завершения
      correct: a.status === 'IN_PROGRESS' ? 0 : a.correctCount,
      wrong: a.status === 'IN_PROGRESS' ? 0 : a.wrongCount,
      reason: a.resultReason ? EXAM_REASON_TEXT[a.resultReason as keyof typeof EXAM_REASON_TEXT] ?? null : null,
      xpAwarded: xpEvent?.amount ?? 0,
      isDemo: qs.some((q) => q.isDemo),
    };
  }
}
