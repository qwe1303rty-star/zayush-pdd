import { ACHIEVEMENTS, DEFAULT_RANKS, LEGACY_RANK_CODES } from '@zayush/shared';
import type { Db } from '../db.js';

/** Формат файла контента — см. content/abm/content.json (собирается scripts/build-abm-content.mjs) и docs/content-import.md */
export interface ContentFile {
  set?: { code: string; title: string; isDemo: boolean };
  sources?: { pdd?: string; signs?: string };
  topics?: { slug: string; title: string; description?: string; examBlock?: number | null; sortOrder?: number }[];
  tickets?: { number: number; title: string; questions: string[] }[];
  /** Снять с публикации старые наборы: вопросы с такими префиксами externalId и билеты с такими setCode */
  retire?: { questionPrefixes?: string[]; ticketSets?: string[] };
  questions: {
    externalId: string;
    topic: string;
    scene?: string | null;
    hint?: string | null;
    text: string;
    officialText?: string | null;
    examBlock?: number | null;
    imageUrl?: string | null;
    imageAlt?: string | null;
    options: { text: string; correct?: boolean; whyWrong?: string }[];
    explanation: string;
    takeaway?: string | null;
    clauseRefs?: string[];
    signRefs?: string[];
    sourceUrl?: string | null;
  }[];
  signs?: { code: string; title: string; category: string; description: string; penalty?: string | null; example?: string | null; imageUrl: string; imageVerified?: boolean }[];
  knowledge?: { externalId: string; title: string; keywords: string[]; answer: string; clauseRefs?: string[]; signRefs?: string[] }[];
}

const LABELS = ['А', 'Б', 'В', 'Г', 'Д'];

export interface ImportReport {
  topics: number;
  tickets: number;
  questions: number;
  signs: number;
  knowledge: number;
  errors: string[];
}

export function validateContent(file: ContentFile): string[] {
  const errs: string[] = [];
  const topicSlugs = new Set(file.topics?.map((t) => t.slug) ?? []);
  const ids = new Set<string>();
  for (const q of file.questions) {
    if (ids.has(q.externalId)) errs.push(`${q.externalId}: дублируется externalId`);
    ids.add(q.externalId);
    const correct = q.options.filter((o) => o.correct).length;
    if (correct !== 1) errs.push(`${q.externalId}: правильных ответов ${correct}, нужен ровно 1`);
    if (q.options.length < 2 || q.options.length > 5) errs.push(`${q.externalId}: вариантов должно быть 2–5`);
    if (!q.explanation || q.explanation.length < 10) errs.push(`${q.externalId}: нет объяснения`);
    if (file.topics && !topicSlugs.has(q.topic)) errs.push(`${q.externalId}: неизвестная тема ${q.topic}`);
    for (const c of q.clauseRefs ?? []) if (!/^\d{1,2}(\.\d{1,2}){1,2}$/.test(c)) errs.push(`${q.externalId}: странный пункт ПДД «${c}»`);
  }
  for (const t of file.tickets ?? []) for (const qid of t.questions) if (!ids.has(qid)) errs.push(`Билет ${t.number}: нет вопроса ${qid}`);
  return errs;
}

export async function importContent(db: Db, file: ContentFile): Promise<ImportReport> {
  const errors = validateContent(file);
  if (errors.length) return { topics: 0, tickets: 0, questions: 0, signs: 0, knowledge: 0, errors };

  const setCode = file.set?.code ?? 'custom';
  const isDemo = file.set?.isDemo ?? true;
  const sourceUrl = file.sources?.pdd ?? null;
  const report: ImportReport = { topics: 0, tickets: 0, questions: 0, signs: 0, knowledge: 0, errors: [] };

  await db.$transaction(
    async (tx) => {
      for (const prefix of file.retire?.questionPrefixes ?? []) {
        await tx.question.updateMany({ where: { externalId: { startsWith: prefix } }, data: { isPublished: false } });
      }
      for (const setCodeOld of file.retire?.ticketSets ?? []) {
        await tx.ticket.updateMany({ where: { setCode: setCodeOld }, data: { isPublished: false } });
      }
      for (const t of file.topics ?? []) {
        await tx.topic.upsert({
          where: { slug: t.slug },
          create: { slug: t.slug, title: t.title, description: t.description ?? null, examBlock: t.examBlock ?? null, sortOrder: t.sortOrder ?? 0 },
          update: { title: t.title, description: t.description ?? null, examBlock: t.examBlock ?? null, sortOrder: t.sortOrder ?? 0 },
        });
        report.topics++;
      }
      const topics = new Map((await tx.topic.findMany()).map((t) => [t.slug, t.id]));

      // Билет и позиция для каждого вопроса
      const placement = new Map<string, { ticketId: string; position: number }>();
      for (const t of file.tickets ?? []) {
        const ticket = await tx.ticket.upsert({
          where: { setCode_number: { setCode, number: t.number } },
          create: { setCode, number: t.number, title: t.title, isDemo },
          update: { title: t.title, isDemo },
        });
        t.questions.forEach((qid, i) => placement.set(qid, { ticketId: ticket.id, position: i + 1 }));
        report.tickets++;
      }

      for (const q of file.questions) {
        const topicId = topics.get(q.topic);
        if (!topicId) {
          report.errors.push(`${q.externalId}: тема ${q.topic} не найдена`);
          continue;
        }
        const pl = placement.get(q.externalId);
        const data = {
          topicId,
          ticketId: pl?.ticketId ?? null,
          ticketPosition: pl?.position ?? null,
          scene: q.scene ?? null,
          hint: q.hint ?? null,
          officialText: q.officialText ?? null,
          examBlock: q.examBlock ?? null,
          text: q.text,
          imageUrl: q.imageUrl ?? null,
          imageAlt: q.imageAlt ?? null,
          explanation: q.explanation,
          takeaway: q.takeaway ?? null,
          clauseRefs: q.clauseRefs ?? [],
          signRefs: q.signRefs ?? [],
          sourceUrl: q.sourceUrl ?? sourceUrl,
          isDemo,
          isPublished: true,
          verifiedAt: new Date(),
        };
        const saved = await tx.question.upsert({ where: { externalId: q.externalId }, create: { externalId: q.externalId, ...data }, update: data });
        const existing = await tx.answerOption.findMany({ where: { questionId: saved.id }, orderBy: { sortOrder: 'asc' } });
        for (const [i, o] of q.options.entries()) {
          const od = { label: LABELS[i], text: o.text, isCorrect: !!o.correct, whyWrong: o.whyWrong ?? null, sortOrder: i };
          if (existing[i]) await tx.answerOption.update({ where: { id: existing[i].id }, data: od });
          else await tx.answerOption.create({ data: { ...od, questionId: saved.id } });
        }
        for (const extra of existing.slice(q.options.length)) await tx.answerOption.delete({ where: { id: extra.id } });
        report.questions++;
      }

      for (const [i, s] of (file.signs ?? []).entries()) {
        const data = {
          title: s.title,
          category: s.category,
          description: s.description,
          penalty: s.penalty ?? null,
          example: s.example ?? null,
          imageUrl: s.imageUrl,
          imageVerified: s.imageVerified ?? false,
          sortOrder: i,
        };
        await tx.roadSign.upsert({ where: { code: s.code }, create: { code: s.code, ...data }, update: data });
        report.signs++;
      }

      for (const k of file.knowledge ?? []) {
        const data = { title: k.title, keywords: k.keywords.map((x) => x.toLowerCase()), answer: k.answer, clauseRefs: k.clauseRefs ?? [], signRefs: k.signRefs ?? [] };
        await tx.knowledgeEntry.upsert({ where: { externalId: k.externalId }, create: { externalId: k.externalId, ...data }, update: data });
        report.knowledge++;
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
  return report;
}

/** Ранги и достижения по умолчанию (только если их ещё нет — правки из админки не затираются) */
export async function seedDefaults(db: Db) {
  const existing = await db.rank.findMany({ select: { code: true } });
  // Базы, созданные первой версией (ранги не совпадали с картинками), обновляются автоматически.
  // Ранги, которые владелец уже переименовал в админке, не трогаем.
  const isLegacy = existing.length > 0 && existing.every((r) => LEGACY_RANK_CODES.includes(r.code));
  if (existing.length === 0 || isLegacy) {
    const data = DEFAULT_RANKS.map((r, i) => ({ code: r.code, title: r.title, minXp: r.minXp, tagline: r.tagline, image: r.image, rewards: r.rewards, sortOrder: i }));
    await db.$transaction([db.rank.deleteMany({}), db.rank.createMany({ data })]);
    if (isLegacy) {
      // Выдать награды новых рангов тем, кто уже набрал нужный XP
      const users = await db.user.findMany({ select: { id: true, xp: true } });
      const grants = users.flatMap((u) =>
        DEFAULT_RANKS.filter((r) => u.xp >= r.minXp).flatMap((r) => r.rewards.map((rewardCode) => ({ userId: u.id, rewardCode, source: `rank:${r.code}` }))),
      );
      if (grants.length) await db.userReward.createMany({ data: grants, skipDuplicates: true });
    }
  }
  // Ранг с чужим товарным знаком в названии переименован (картинка rank-r7 перерисована)
  await db.rank.updateMany({ where: { code: 'model-vs', title: 'Модель Victoria’s Secret' }, data: { title: 'Топ-модель' } });
  // Закон о русском языке: заимствования без словарной нормы в текстах интерфейса заменены
  await db.rank.updateMany({ where: { tagline: 'Знаки читаешь как ленту сторис.' }, data: { tagline: 'Знаки читаешь как любимый журнал.' } });
  for (const [i, a] of ACHIEVEMENTS.entries()) {
    await db.achievement.upsert({
      where: { code: a.code },
      create: { code: a.code, title: a.title, description: a.description, icon: a.icon, xpReward: a.xpReward, sortOrder: i },
      update: {},
    });
  }
}
