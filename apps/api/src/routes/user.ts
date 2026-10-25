import { SIGN_CATEGORIES, type SignDTO, voiceVariants, VOICE, type VoiceKey } from '@zayush/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { makeAuthenticate } from '../plugins/auth.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw errors.badRequest(r.error.issues[0]?.message ?? 'Некорректные данные');
  return r.data;
}

const id = z.string().min(1).max(64);

export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  const authenticate = makeAuthenticate(ctx);
  app.addHook('preHandler', authenticate);

  /** Охрана для защищённых операций при включённой обязательной подписке */
  const guard = async (req: FastifyRequest) => {
    await ctx.subscription.assertAccess(req.user.id, req.user.telegramId);
  };

  // ── Доступ (не защищено подпиской — это и есть экран проверки) ──
  app.get('/gate', async (req) => ctx.subscription.status(req.user.id));
  app.post('/gate/check', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) =>
    ctx.subscription.check(req.user.id, req.user.telegramId),
  );

  app.get('/me', async (req) => ctx.profile.me(req.user, req.isAdmin));

  app.get('/texts', async () => {
    const overrides = await ctx.settings.texts();
    const out: Record<string, readonly string[]> = {};
    for (const k of Object.keys(VOICE) as VoiceKey[]) out[k] = voiceVariants(k, overrides);
    return out;
  });

  // ── Всё ниже требует пройденной проверки подписки (если она включена) ──
  app.register(async (p) => {
    p.addHook('preHandler', guard);

    p.patch('/me/settings', async (req) => {
      const body = parse(z.object({ notificationsEnabled: z.boolean().optional() }), req.body);
      const u = await ctx.db.user.update({ where: { id: req.user.id }, data: body });
      return { notificationsEnabled: u.notificationsEnabled };
    });

    p.post('/me/reset-progress', async (req) => {
      parse(z.object({ confirm: z.literal('RESET') }), req.body);
      await ctx.learning.resetProgress(req.user.id);
      return { ok: true };
    });

    p.get('/topics', async (req) => ctx.learning.topics(req.user.id));
    p.get('/tickets', async (req) => ctx.learning.tickets(req.user.id));
    p.get('/sets/ticket/:id', async (req) => ctx.learning.ticketSet(req.user.id, parse(id, (req.params as { id: string }).id)));
    p.get('/sets/topic/:slug', async (req) => ctx.learning.topicSet(req.user.id, parse(id, (req.params as { slug: string }).slug)));
    p.get('/sets/mistakes', async (req) => ctx.learning.mistakesSet(req.user.id));
    p.get('/sets/favorites', async (req) => ctx.learning.favoritesSet(req.user.id));
    p.get('/sets/daily', async (req) => ctx.learning.dailySet(req.user.id));

    p.post('/answers', async (req) => {
      const body = parse(
        z.object({
          questionId: id,
          optionId: id,
          mode: z.enum(['TRAINING', 'MISTAKES', 'DAILY']),
          clientAttemptId: z.string().uuid(),
          ticketId: id.optional(),
        }),
        req.body,
      );
      return ctx.learning.answer(req.user.id, body);
    });

    p.put('/questions/:id/favorite', async (req) => {
      const body = parse(z.object({ favorite: z.boolean() }), req.body);
      return ctx.learning.setFavorite(req.user.id, parse(id, (req.params as { id: string }).id), body.favorite);
    });

    p.post('/reports', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(z.object({ questionId: id.optional(), message: z.string().trim().min(3).max(1000) }), req.body);
      if (body.questionId) {
        const q = await ctx.db.question.findUnique({ where: { id: body.questionId }, select: { id: true } });
        if (!q) throw errors.notFound('Вопрос не найден');
      }
      await ctx.db.feedbackReport.create({ data: { userId: req.user.id, questionId: body.questionId, message: body.message } });
      return { ok: true };
    });

    // ── Экзамен ──
    p.get('/exams', async () => ctx.exam.configs());
    p.get('/exams/active', async (req) => ({ attempt: await ctx.exam.active(req.user.id) }));
    p.get('/exams/history', async (req) => ctx.exam.history(req.user.id));
    p.post('/exams', async (req) => {
      const body = parse(z.object({ examCode: z.string().min(1).max(32) }), req.body);
      return ctx.exam.start(req.user.id, body.examCode);
    });
    p.get('/exams/:id', async (req) => ctx.exam.get(req.user.id, parse(id, (req.params as { id: string }).id)));
    p.post('/exams/:id/answers', async (req) => {
      const body = parse(z.object({ questionId: id, optionId: id }), req.body);
      return ctx.exam.answer(req.user.id, parse(id, (req.params as { id: string }).id), body.questionId, body.optionId);
    });
    p.post('/exams/:id/finish', async (req) => ctx.exam.finish(req.user.id, parse(id, (req.params as { id: string }).id)));
    p.get('/exams/:id/review', async (req) => ctx.exam.review(req.user.id, parse(id, (req.params as { id: string }).id)));

    // ── Знаки ──
    p.get('/signs', async (req) => {
      const q = parse(z.object({ category: z.string().max(32).optional(), q: z.string().max(64).optional() }), req.query);
      const signs = await ctx.db.roadSign.findMany({
        where: {
          isPublished: true,
          ...(q.category ? { category: q.category } : {}),
          ...(q.q
            ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { code: { startsWith: q.q } }, { description: { contains: q.q, mode: 'insensitive' } }] }
            : {}),
        },
        orderBy: { sortOrder: 'asc' },
      });
      const favs = await ctx.db.favoriteSign.findMany({ where: { userId: req.user.id }, select: { signId: true } });
      const fset = new Set(favs.map((f) => f.signId));
      const list: SignDTO[] = signs.map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        category: s.category,
        description: s.description,
        example: s.example,
        imageUrl: s.imageUrl,
        imageVerified: s.imageVerified,
        penalty: s.penalty,
        isFavorite: fset.has(s.id),
      }));
      return { categories: SIGN_CATEGORIES, signs: list };
    });
    p.put('/signs/:id/favorite', async (req) => {
      const body = parse(z.object({ favorite: z.boolean() }), req.body);
      const signId = parse(id, (req.params as { id: string }).id);
      const s = await ctx.db.roadSign.findUnique({ where: { id: signId }, select: { id: true } });
      if (!s) throw errors.notFound('Знак не найден');
      if (body.favorite) {
        await ctx.db.favoriteSign.createMany({ data: [{ userId: req.user.id, signId }], skipDuplicates: true });
        await ctx.profile.checkSignsFan(req.user.id);
      } else await ctx.db.favoriteSign.deleteMany({ where: { userId: req.user.id, signId } });
      return { favorite: body.favorite };
    });

    // ── Помощник ──
    p.get('/assistant/info', async () => ({ mode: ctx.assistant.mode }));
    p.post('/assistant', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(z.object({ message: z.string().trim().min(2).max(800) }), req.body);
      return ctx.assistant.ask(body.message, await ctx.settings.texts());
    });

    // ── Гараж ──
    p.get('/garage', async (req) => ctx.profile.garage(req.user));
    p.put('/garage/car', async (req) => {
      const body = parse(z.object({ code: z.string().max(32) }), req.body);
      return ctx.profile.equipCar(req.user, body.code);
    });
  });
}
