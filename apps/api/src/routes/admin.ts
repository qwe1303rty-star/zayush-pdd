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

/** Начало текущих суток по московскому времени, в UTC */
function startOfMoscowDay(): Date {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - 3 * 3_600_000);
}

/** Поиск по Telegram ID, если строка — число */
function toTgId(s?: string): { telegramId: bigint } | undefined {
  if (s && /^\d{3,15}$/.test(s.trim())) return { telegramId: BigInt(s.trim()) };
  return undefined;
}

/** Сколько пользователей онлайн: уникальные отметки за окно ACTIVITY_ONLINE_MIN */
async function onlineCount(ctx: AppContext): Promise<number> {
  const from = new Date(Date.now() - ctx.env.ACTIVITY_ONLINE_MIN * 60_000);
  const r = await ctx.db.activityPing.findMany({ where: { at: { gte: from } }, distinct: ['userId'], select: { userId: true } });
  return r.length;
}

/** Пиковый онлайн: максимум уникальных пользователей в бакете (минуты/часы) за период */
async function peakBucketed(ctx: AppContext, from: Date, unit: 'minute' | 'hour', _sizeMin: number): Promise<{ users: number; at: Date } | null> {
  const rows = await ctx.db.$queryRaw<{ bucket: Date; users: bigint }[]>`
    SELECT date_trunc(${unit}, "at") AS bucket, count(DISTINCT "userId")::bigint AS users
    FROM "ActivityPing" WHERE "at" >= ${from} GROUP BY 1 ORDER BY users DESC LIMIT 1`;
  const r = rows[0];
  return r ? { users: Number(r.users), at: r.bucket } : { users: 0, at: new Date() };
}

/** Сессии из отметок присутствия: разрыв больше (ping+5) минут начинает новую сессию */
function buildSessions(dates: Date[], pingMin: number): { start: Date; end: Date; minutes: number; pings: number }[] {
  const asc = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gap = (pingMin + 5) * 60_000;
  const out: { start: Date; end: Date; minutes: number; pings: number }[] = [];
  for (const d of asc) {
    const cur = out[out.length - 1];
    if (cur && d.getTime() - cur.end.getTime() <= gap) {
      cur.end = d;
      cur.pings++;
    } else out.push({ start: d, end: d, minutes: 0, pings: 1 });
  }
  for (const s of out) s.minutes = Math.max(1, Math.round((s.end.getTime() - s.start.getTime()) / 60_000) + pingMin);
  return out.reverse();
}

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
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [users, active7, answers, answers7, questions, demo, openReports, exams, examsPassed] = await Promise.all([
      ctx.db.user.count(),
      ctx.db.user.count({ where: { updatedAt: { gte: since } } }),
      ctx.db.userAnswer.count(),
      ctx.db.userAnswer.count({ where: { createdAt: { gte: since } } }),
      ctx.db.question.count({ where: { isPublished: true } }),
      ctx.db.question.count({ where: { isPublished: true, isDemo: true } }),
      ctx.db.feedbackReport.count({ where: { status: 'OPEN' } }),
      ctx.db.examAttempt.count({ where: { status: { not: 'IN_PROGRESS' } } }),
      ctx.db.examAttempt.count({ where: { status: 'PASSED' } }),
    ]);
    const hardest = await ctx.db.mistake.groupBy({ by: ['questionId'], _count: { _all: true }, orderBy: { _count: { questionId: 'desc' } }, take: 5 });
    const hq = await ctx.db.question.findMany({ where: { id: { in: hardest.map((h) => h.questionId) } }, select: { id: true, text: true, externalId: true } });

    const day = new Date(Date.now() - 86_400_000);
    const [newToday, new7, onlineNow, peakDay, peakWeek] = await Promise.all([
      ctx.db.user.count({ where: { createdAt: { gte: startOfMoscowDay() } } }),
      ctx.db.user.count({ where: { createdAt: { gte: since } } }),
      ctx.activity.enabled ? onlineCount(ctx) : Promise.resolve(null),
      ctx.activity.enabled ? peakBucketed(ctx, day, 'minute', ctx.env.ACTIVITY_ONLINE_MIN) : Promise.resolve(null),
      ctx.activity.enabled ? peakBucketed(ctx, since, 'hour', 60) : Promise.resolve(null),
    ]);

    return {
      users,
      active7,
      newToday,
      new7,
      answers,
      answers7,
      questions,
      demoQuestions: demo,
      openReports,
      exams,
      examsPassed,
      activityTracking: ctx.activity.enabled,
      onlineNow,
      peakDay,
      peakWeek,
      onlineWindowMin: ctx.env.ACTIVITY_ONLINE_MIN,
      hardest: hardest.map((h) => ({ ...hq.find((q) => q.id === h.questionId), mistakes: h._count._all })),
    };
  });

  // ── Аналитика посещаемости (ПДн; доступна при ACTIVITY_TRACKING) ──
  const requireActivity = () => {
    if (!ctx.activity.enabled) throw errors.badRequest('Аналитика посещаемости выключена (ACTIVITY_TRACKING=false)');
  };

  /** Тайм-серия для диаграммы: range=day — 24 часа, range=week — 7 дней (время московское) */
  app.get('/activity', async (req) => {
    requireActivity();
    const q = parse(z.object({ range: z.enum(['day', 'week']).default('day') }), req.query);
    const unit = q.range === 'day' ? 'hour' : 'day';
    const from = q.range === 'day' ? startOfMoscowDay() : new Date(Date.now() - 6 * 86_400_000);
    const rows = await ctx.db.$queryRaw<{ bucket: Date; users: bigint; pings: bigint }[]>`
      SELECT date_trunc(${unit}, "at" AT TIME ZONE 'Europe/Moscow') AS bucket,
             count(DISTINCT "userId")::bigint AS users,
             count(*)::bigint AS pings
      FROM "ActivityPing"
      WHERE "at" >= ${from}
      GROUP BY 1 ORDER BY 1`;
    return { range: q.range, unit, points: rows.map((r) => ({ t: r.bucket, users: Number(r.users), pings: Number(r.pings) })) };
  });

  /** Список пользователей с посещаемостью */
  app.get('/users', async (req) => {
    const q = parse(
      z.object({
        search: z.string().max(64).optional(),
        sort: z.enum(['recent', 'new', 'xp', 'answers']).default('recent'),
        page: z.coerce.number().int().min(0).max(10_000).default(0),
      }),
      req.query,
    );
    const take = 50;
    const where = q.search?.trim()
      ? { OR: [{ firstName: { contains: q.search.trim(), mode: 'insensitive' as const } }, toTgId(q.search)].filter(Boolean) as object[] }
      : {};
    const orderBy =
      q.sort === 'new' ? { createdAt: 'desc' as const } : q.sort === 'xp' ? { xp: 'desc' as const } : { lastSeenAt: 'desc' as const };
    const [total, rows] = await Promise.all([
      ctx.db.user.count({ where }),
      ctx.db.user.findMany({
        where,
        orderBy,
        skip: q.page * take,
        take,
        select: {
          id: true,
          firstName: true,
          telegramId: true,
          xp: true,
          streakDays: true,
          lastSeenAt: true,
          createdAt: true,
          botCanWrite: true,
          _count: { select: { answers: true, examAttempts: true } },
        },
      }),
    ]);
    const online = ctx.env.ACTIVITY_ONLINE_MIN * 60_000;
    return {
      total,
      page: q.page,
      pageSize: take,
      activityTracking: ctx.activity.enabled,
      users: rows.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        telegramId: String(u.telegramId),
        xp: u.xp,
        streakDays: u.streakDays,
        answers: u._count.answers,
        exams: u._count.examAttempts,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        online: Date.now() - u.lastSeenAt.getTime() < online,
      })),
    };
  });

  /** Карточка пользователя: профиль, сессии и активность по минутам/часам/дням */
  app.get('/users/:id', async (req) => {
    const uid = parse(id, (req.params as { id: string }).id);
    const q = parse(z.object({ bucket: z.enum(['minute', 'hour', 'day']).default('day'), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    const u = await ctx.db.user.findUnique({
      where: { id: uid },
      select: { id: true, firstName: true, telegramId: true, xp: true, streakDays: true, bestStreak: true, lastSeenAt: true, createdAt: true, consentAt: true, botCanWrite: true, notificationsEnabled: true, _count: { select: { answers: true, examAttempts: true, mistakes: true } } },
    });
    if (!u) throw errors.notFound('Пользователь не найден');

    let series: { t: Date; pings: number }[] = [];
    let sessions: { start: Date; end: Date; minutes: number; pings: number }[] = [];
    if (ctx.activity.enabled) {
      const unit = q.bucket;
      const from =
        unit === 'minute'
          ? new Date((q.day ? Date.parse(q.day + 'T00:00:00+03:00') : startOfMoscowDay().getTime()))
          : unit === 'hour'
            ? new Date(Date.now() - 2 * 86_400_000)
            : new Date(Date.now() - 30 * 86_400_000);
      const to = unit === 'minute' ? new Date(from.getTime() + 86_400_000) : new Date(Date.now() + 1000);
      const rows = await ctx.db.$queryRaw<{ bucket: Date; pings: bigint }[]>`
        SELECT date_trunc(${unit}, "at" AT TIME ZONE 'Europe/Moscow') AS bucket, count(*)::bigint AS pings
        FROM "ActivityPing" WHERE "userId" = ${uid} AND "at" >= ${from} AND "at" < ${to}
        GROUP BY 1 ORDER BY 1`;
      series = rows.map((r) => ({ t: r.bucket, pings: Number(r.pings) }));

      // Сессии: соседние отметки с разрывом менее 30 минут — одна сессия
      const pings = await ctx.db.activityPing.findMany({ where: { userId: uid }, orderBy: { at: 'desc' }, take: 3000, select: { at: true } });
      sessions = buildSessions(pings.map((p) => p.at), ctx.env.ACTIVITY_PING_MIN).slice(0, 100);
    }

    const totalMinutes = sessions.reduce((s, x) => s + x.minutes, 0);
    return {
      user: {
        id: u.id,
        firstName: u.firstName,
        telegramId: String(u.telegramId),
        xp: u.xp,
        streakDays: u.streakDays,
        bestStreak: u.bestStreak,
        answers: u._count.answers,
        exams: u._count.examAttempts,
        mistakes: u._count.mistakes,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        consentAt: u.consentAt,
        botCanWrite: u.botCanWrite,
        notificationsEnabled: u.notificationsEnabled,
      },
      activityTracking: ctx.activity.enabled,
      bucket: q.bucket,
      series,
      sessions,
      sessionsTotal: sessions.length,
      totalMinutes,
    };
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
