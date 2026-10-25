import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DEFAULT_RANKS, DEFAULT_XP, isValidChatId, isValidInviteUrl, mergeXpConfig, VOICE } from '@zayush/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { makeAuthenticate, makeAuthenticateAdmin } from '../plugins/auth.js';
import { importContent, type ContentFile } from '../services/content-import.js';
import { parse } from './user.js';

const id = z.string().min(1).max(64);
const LABELS = ['А', 'Б', 'В', 'Г', 'Д'];

const questionBody = z.object({
  externalId: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'externalId: только латиница, цифры и дефис'),
  topicSlug: z.string().min(1),
  ticketId: z.string().nullable().optional(),
  ticketPosition: z.number().int().positive().nullable().optional(),
  scene: z.string().max(600).nullable().optional(),
  hint: z.string().max(400).nullable().optional(),
  text: z.string().min(5).max(800),
  imageUrl: z.string().max(300).nullable().optional(),
  imageAlt: z.string().max(300).nullable().optional(),
  explanation: z.string().min(10).max(4000),
  takeaway: z.string().max(400).nullable().optional(),
  clauseRefs: z.array(z.string().regex(/^\d{1,2}(\.\d{1,2}){1,2}$/, 'Пункт ПДД вида 10.2 или 2.1.2')).max(10),
  signRefs: z.array(z.string().regex(/^\d\.\d{1,2}(\.\d)?$/, 'Знак вида 5.16 или 1.20.1')).max(10),
  sourceUrl: z.string().url().nullable().optional(),
  isDemo: z.boolean(),
  isPublished: z.boolean(),
  verified: z.boolean().optional(),
  options: z
    .array(z.object({ text: z.string().min(1).max(300), isCorrect: z.boolean(), whyWrong: z.string().max(600).nullable().optional() }))
    .min(2)
    .max(5)
    .refine((o) => o.filter((x) => x.isCorrect).length === 1, 'Должен быть ровно один правильный ответ'),
});

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const authenticate = makeAuthenticate(ctx);
  app.addHook('preHandler', makeAuthenticateAdmin(ctx, authenticate));

  app.get('/whoami', async () => ({ admin: true }));

  // ── Статистика ──
  app.get('/stats', async () => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const since7 = new Date(now.getTime() - 7 * 86_400_000);
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const since14 = new Date(now.getTime() - 14 * 86_400_000);

    const [
      users,
      newUsers7,
      newToday,
      activeNow,
      activeToday,
      active7,
      active30,
      answers,
      answers7,
      questions,
      demo,
      openReports,
      exams,
      examsPassed,
      mistakesTotal,
      mistakesOpen,
      favorites,
    ] = await Promise.all([
      ctx.db.user.count(),
      ctx.db.user.count({ where: { createdAt: { gte: since7 } } }),
      ctx.db.user.count({ where: { createdAt: { gte: dayStart } } }),
      ctx.db.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 5 * 60_000) } } }),
      ctx.db.user.count({ where: { lastSeenAt: { gte: dayStart } } }),
      ctx.db.user.count({ where: { lastSeenAt: { gte: since7 } } }),
      ctx.db.user.count({ where: { lastSeenAt: { gte: since30 } } }),
      ctx.db.userAnswer.count(),
      ctx.db.userAnswer.count({ where: { createdAt: { gte: since7 } } }),
      ctx.db.question.count({ where: { isPublished: true } }),
      ctx.db.question.count({ where: { isPublished: true, isDemo: true } }),
      ctx.db.feedbackReport.count({ where: { status: 'OPEN' } }),
      ctx.db.examAttempt.count({ where: { status: { not: 'IN_PROGRESS' } } }),
      ctx.db.examAttempt.count({ where: { status: 'PASSED' } }),
      ctx.db.mistake.count(),
      ctx.db.mistake.count({ where: { resolvedAt: null } }),
      ctx.db.favoriteQuestion.count(),
    ]);

    const sessions7Rows = await ctx.db.userSession.findMany({ where: { startedAt: { gte: since7 } }, select: { startedAt: true, lastSeenAt: true } });
    const sessions7 = sessions7Rows.length;
    const avgSessionMinutes7 = sessions7
      ? Math.round((sessions7Rows.reduce((acc, s) => {
          const ms = Math.min(s.lastSeenAt.getTime() - s.startedAt.getTime(), 30 * 60 * 1000);
          return acc + Math.max(0, ms);
        }, 0) / sessions7 / 60000) * 10) / 10
      : 0;

    const answers14 = await ctx.db.userAnswer.findMany({ where: { createdAt: { gte: since14 } }, select: { createdAt: true, userId: true } });
    const sessions14 = await ctx.db.userSession.findMany({ where: { startedAt: { gte: since14 } }, select: { startedAt: true, userId: true } });
    const dailyMap = new Map<string, { day: string; users: Set<string>; answers: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { day: key, users: new Set(), answers: 0 });
    }
    for (const a of answers14) {
      const key = a.createdAt.toISOString().slice(0, 10);
      const row = dailyMap.get(key);
      if (row) { row.answers++; row.users.add(a.userId); }
    }
    for (const s of sessions14) {
      const key = s.startedAt.toISOString().slice(0, 10);
      const row = dailyMap.get(key);
      if (row) row.users.add(s.userId);
    }
    const dailyActivity = [...dailyMap.values()].map((r) => ({ day: r.day, users: r.users.size, answers: r.answers }));

    const topics = await ctx.db.topic.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, _count: { select: { questions: true } } } });
    const topTopics = (await Promise.all(topics.map(async (t) => {
      const [totalAnswers, correctAnswers] = await Promise.all([
        ctx.db.userAnswer.count({ where: { question: { topicId: t.id } } }),
        ctx.db.userAnswer.count({ where: { question: { topicId: t.id }, isCorrect: true } }),
      ]);
      return { title: t.title, questions: t._count.questions, answers: totalAnswers, correct: correctAnswers, accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0 };
    }))).sort((a, b) => b.answers - a.answers).slice(0, 8);

    const hardest = await ctx.db.mistake.groupBy({ by: ['questionId'], _count: { _all: true }, orderBy: { _count: { questionId: 'desc' } }, take: 5 });
    const hq = await ctx.db.question.findMany({ where: { id: { in: hardest.map((h) => h.questionId) } }, select: { id: true, text: true, externalId: true } });

    return {
      users,
      newUsers7,
      newToday,
      activeNow,
      activeToday,
      active7,
      active30,
      answers,
      answers7,
      questions,
      demoQuestions: demo,
      openReports,
      exams,
      examsPassed,
      mistakesTotal,
      mistakesOpen,
      favorites,
      sessions7,
      avgSessionMinutes7,
      dailyActivity,
      topTopics,
      hardest: hardest.map((h) => ({ ...hq.find((q) => q.id === h.questionId), mistakes: h._count._all })),
    };
  });

  // ── Активность по минутам ──
  app.get('/activity', async (req) => {
    const q = parse(z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      hours: z.coerce.number().int().min(1).max(720).optional(),
      newOnly: z.coerce.boolean().optional(),
      activeNow: z.coerce.boolean().optional(),
      groupBy: z.enum(['day', 'hour', 'minute']).optional(),
    }), req.query);
    const limit = q.limit ?? 200;
    const hours = q.hours ?? 24;
    const since = new Date(Date.now() - hours * 3600_000);
    const now = Date.now();
    const activeThreshold = new Date(now - 5 * 60_000);
    const sessions = await ctx.db.userSession.findMany({
      where: {
        startedAt: { gte: since },
        ...(q.activeNow ? { lastSeenAt: { gte: activeThreshold } } : {}),
        ...(q.newOnly ? { user: { createdAt: { gte: since } } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, firstName: true, telegramId: true, createdAt: true, lastSeenAt: true } } },
    });
    const mapped = sessions.map((s) => ({
      id: s.id,
      userId: s.user.id,
      firstName: s.user.firstName,
      telegramId: String(s.user.telegramId),
      isNew: s.user.createdAt >= since,
      isActiveNow: s.user.lastSeenAt >= activeThreshold,
      startedAt: s.startedAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      durationMin: Math.max(0, Math.round((Math.min(s.lastSeenAt.getTime(), now) - s.startedAt.getTime()) / 60000)),
    }));

    if (!q.groupBy) return mapped;

    // Агрегация по периодам
    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      if (q.groupBy === 'day') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (q.groupBy === 'hour') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const groups = new Map<string, { period: string; count: number; users: Set<string> }>();
    for (const s of sessions) {
      const key = fmt(s.startedAt);
      if (!groups.has(key)) groups.set(key, { period: key, count: 0, users: new Set() });
      const g = groups.get(key)!;
      g.count++;
      g.users.add(s.user.id);
    }
    const timeline = [...groups.values()]
      .map((g) => ({ period: g.period, count: g.count, users: g.users.size }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return { timeline, sessions: mapped };
  });

  // ── Темы и билеты ──
  app.get('/topics', async () => ctx.db.topic.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { questions: true } } } }));
  app.put('/topics/:id', async (req) => {
    const b = parse(
      z.object({ title: z.string().min(2).max(80), description: z.string().max(200).nullable(), examBlock: z.number().int().min(1).max(4).nullable(), sortOrder: z.number().int() }),
      req.body,
    );
    return ctx.db.topic.update({ where: { id: parse(id, (req.params as { id: string }).id) }, data: b });
  });
  app.post('/topics', async (req) => {
    const b = parse(
      z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(2).max(80), description: z.string().max(200).nullable().optional(), examBlock: z.number().int().min(1).max(4).nullable().optional() }),
      req.body,
    );
    return ctx.db.topic.create({ data: b });
  });
  app.get('/tickets', async () =>
    ctx.db.ticket.findMany({ orderBy: [{ setCode: 'asc' }, { number: 'asc' }], include: { _count: { select: { questions: true } } } }),
  );
  app.post('/tickets', async (req) => {
    const b = parse(z.object({ setCode: z.string().regex(/^[a-z0-9-]+$/), number: z.number().int().positive(), title: z.string().min(1).max(80), isDemo: z.boolean() }), req.body);
    return ctx.db.ticket.create({ data: b });
  });
  app.put('/tickets/:id', async (req) => {
    const b = parse(z.object({ title: z.string().min(1).max(80), isPublished: z.boolean(), isDemo: z.boolean() }), req.body);
    return ctx.db.ticket.update({ where: { id: parse(id, (req.params as { id: string }).id) }, data: b });
  });

  // ── Вопросы ──
  app.get('/questions', async (req) => {
    const q = parse(z.object({ search: z.string().max(100).optional(), topic: z.string().optional(), ticket: z.string().optional() }), req.query);
    return ctx.db.question.findMany({
      where: {
        ...(q.search ? { OR: [{ text: { contains: q.search, mode: 'insensitive' } }, { externalId: { contains: q.search } }] } : {}),
        ...(q.topic ? { topic: { slug: q.topic } } : {}),
        ...(q.ticket ? { ticketId: q.ticket } : {}),
      },
      orderBy: [{ externalId: 'asc' }],
      include: { topic: { select: { slug: true, title: true } }, ticket: { select: { number: true, setCode: true } }, _count: { select: { reports: true, mistakes: true } } },
      take: 300,
    });
  });
  app.get('/questions/:id', async (req) =>
    ctx.db.question.findUniqueOrThrow({
      where: { id: parse(id, (req.params as { id: string }).id) },
      include: { options: { orderBy: { sortOrder: 'asc' } }, topic: true, ticket: true },
    }),
  );

  async function saveQuestion(qid: string | null, body: z.infer<typeof questionBody>) {
    const topic = await ctx.db.topic.findUnique({ where: { slug: body.topicSlug } });
    if (!topic) throw errors.badRequest('Тема не найдена');
    const data = {
      externalId: body.externalId,
      topicId: topic.id,
      ticketId: body.ticketId ?? null,
      ticketPosition: body.ticketPosition ?? null,
      scene: body.scene ?? null,
      hint: body.hint ?? null,
      text: body.text,
      imageUrl: body.imageUrl ?? null,
      imageAlt: body.imageAlt ?? null,
      explanation: body.explanation,
      takeaway: body.takeaway ?? null,
      clauseRefs: body.clauseRefs,
      signRefs: body.signRefs,
      sourceUrl: body.sourceUrl ?? null,
      isDemo: body.isDemo,
      isPublished: body.isPublished,
      ...(body.verified === true ? { verifiedAt: new Date() } : body.verified === false ? { verifiedAt: null } : {}),
    };
    return ctx.db.$transaction(async (tx) => {
      const q = qid ? await tx.question.update({ where: { id: qid }, data }) : await tx.question.create({ data });
      // Варианты пересоздаются только если текст/порядок изменился — иначе сохраняем id (история ответов)
      const existing = await tx.answerOption.findMany({ where: { questionId: q.id }, orderBy: { sortOrder: 'asc' } });
      for (const [i, o] of body.options.entries()) {
        const prev = existing[i];
        const od = { label: LABELS[i], text: o.text, isCorrect: o.isCorrect, whyWrong: o.whyWrong ?? null, sortOrder: i };
        if (prev) await tx.answerOption.update({ where: { id: prev.id }, data: od });
        else await tx.answerOption.create({ data: { ...od, questionId: q.id } });
      }
      for (const extra of existing.slice(body.options.length)) await tx.answerOption.delete({ where: { id: extra.id } });
      return tx.question.findUniqueOrThrow({ where: { id: q.id }, include: { options: { orderBy: { sortOrder: 'asc' } } } });
    });
  }

  app.post('/questions', async (req) => saveQuestion(null, parse(questionBody, req.body)));
  app.put('/questions/:id', async (req) => saveQuestion(parse(id, (req.params as { id: string }).id), parse(questionBody, req.body)));
  app.delete('/questions/:id', async (req) => {
    // Мягкое удаление: снимаем с публикации, история ответов сохраняется
    await ctx.db.question.update({ where: { id: parse(id, (req.params as { id: string }).id) }, data: { isPublished: false } });
    return { ok: true };
  });

  // ── Знаки ──
  app.get('/signs', async () => ctx.db.roadSign.findMany({ orderBy: { sortOrder: 'asc' } }));
  app.put('/signs/:id', async (req) => {
    const b = parse(
      z.object({
        title: z.string().min(2).max(120),
        description: z.string().min(5).max(1500),
        example: z.string().max(400).nullable(),
        imageUrl: z.string().max(300),
        imageVerified: z.boolean(),
        isPublished: z.boolean(),
      }),
      req.body,
    );
    return ctx.db.roadSign.update({ where: { id: parse(id, (req.params as { id: string }).id) }, data: b });
  });

  // ── Импорт контента (JSON) ──
  app.post('/import', { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const body = req.body as ContentFile;
    if (!body || typeof body !== 'object' || !Array.isArray(body.questions)) throw errors.badRequest('Ожидается JSON в формате content.json');
    return importContent(ctx.db, body);
  });

  // ── Загрузка изображений (PNG/JPEG/WebP; SVG не принимаем из соображений безопасности) ──
  app.post('/upload', { bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const b = parse(z.object({ dataBase64: z.string().min(10) }), req.body);
    const buf = Buffer.from(b.dataBase64, 'base64');
    if (buf.length > 2 * 1024 * 1024) throw errors.badRequest('Файл больше 2 МБ');
    let ext: string | null = null;
    if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') ext = 'png';
    else if (buf[0] === 0xff && buf[1] === 0xd8) ext = 'jpg';
    else if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') ext = 'webp';
    if (!ext) throw errors.badRequest('Поддерживаются только PNG, JPEG и WebP');
    const dir = resolve(ctx.env.UPLOAD_DIR);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await writeFile(join(dir, name), buf);
    return { url: `/uploads/${name}` };
  });

  // ── XP, ранги, тексты ──
  app.get('/settings', async () => ({
    xp: await ctx.settings.xp(),
    xpDefaults: DEFAULT_XP,
    texts: await ctx.settings.texts(),
    textDefaults: VOICE,
    ranks: await ctx.settings.ranks(),
    rankDefaults: DEFAULT_RANKS,
  }));
  app.put('/settings/xp', async (req) => {
    const b = parse(z.record(z.string(), z.number().int().min(0).max(10_000)), req.body);
    const merged = mergeXpConfig(b);
    await ctx.settings.set('xp', merged);
    return merged;
  });
  app.put('/settings/texts', async (req) => {
    const b = parse(z.record(z.string(), z.array(z.string().min(1).max(400)).max(20)), req.body);
    const clean: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(b)) if (k in VOICE && v.length) clean[k] = v;
    await ctx.settings.set('texts', clean);
    return clean;
  });
  app.put('/settings/ranks', async (req) => {
    const b = parse(
      z
        .array(
          z.object({
            code: z.string().regex(/^[a-z0-9-]+$/),
            title: z.string().min(2).max(60),
            minXp: z.number().int().min(0),
            tagline: z.string().max(200),
            image: z.string().max(300),
            rewards: z.array(z.string().max(40)).max(10),
          }),
        )
        .min(1)
        .refine((r) => r.some((x) => x.minXp === 0), 'Нужен стартовый ранг с порогом 0 баллов'),
      req.body,
    );
    await ctx.db.$transaction([
      ctx.db.rank.deleteMany({}),
      ctx.db.rank.createMany({ data: b.map((r, i) => ({ ...r, sortOrder: i })) }),
    ]);
    ctx.settings.invalidate();
    return ctx.settings.ranks();
  });

  // ── Обязательная подписка ──
  app.get('/subscriptions', async () => ({
    enabled: (await ctx.settings.get<{ enabled: boolean }>('subscription'))?.enabled ?? false,
    effective: await ctx.subscription.isEnabled(),
    sources: await ctx.db.requiredSubscription.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] }),
    botConfigured: !!ctx.env.BOT_TOKEN,
  }));
  app.put('/subscriptions/enabled', async (req) => {
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    await ctx.settings.set('subscription', { enabled: b.enabled });
    return { enabled: b.enabled, effective: await ctx.subscription.isEnabled() };
  });
  const sourceBody = z.object({
    kind: z.enum(['CHANNEL', 'GROUP']),
    chatId: z.string().refine(isValidChatId, 'chatId: @username или числовой id (-100…)'),
    inviteUrl: z.string().refine(isValidInviteUrl, 'Ссылка вида https://t.me/…'),
    title: z.string().min(2).max(80),
    isActive: z.boolean(),
  });
  app.post('/subscriptions', async (req) => ctx.db.requiredSubscription.create({ data: parse(sourceBody, req.body) }));
  app.put('/subscriptions/:id', async (req) =>
    ctx.db.requiredSubscription.update({ where: { id: parse(id, (req.params as { id: string }).id) }, data: parse(sourceBody, req.body) }),
  );
  app.delete('/subscriptions/:id', async (req) => {
    await ctx.db.requiredSubscription.delete({ where: { id: parse(id, (req.params as { id: string }).id) } });
    return { ok: true };
  });

  // ── Жалобы ──
  app.get('/reports', async (req) => {
    const q = parse(z.object({ status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']).optional() }), req.query);
    return ctx.db.feedbackReport.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { question: { select: { id: true, externalId: true, text: true } }, user: { select: { firstName: true } } },
    });
  });
  app.put('/reports/:id', async (req) => {
    const b = parse(z.object({ status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']), adminNote: z.string().max(500).nullable().optional() }), req.body);
    return ctx.db.feedbackReport.update({ where: { id: parse(id, (req.params as { id: string }).id) }, data: b });
  });
}
