import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnswerResultDTO, ExamStateDTO, MeDTO, QuestionSetDTO, TicketDTO } from '@zayush/shared';
import { verifyInitData, InitDataValidationError } from '../src/telegram/init-data.js';
import { ADMIN_TG, ADMIN_TOKEN, auth, BOT_TOKEN, consent, correctOptionId, initData, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
  await consent(t.app, 5001, 5002, 5003, 5004, 7001, 9999, ADMIN_TG);
});
afterAll(async () => {
  await t.app.close();
});

const U1 = 5001;

async function answer(userId: number, questionId: string, optionId: string, clientAttemptId = randomUUID(), extra: Record<string, unknown> = {}) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/answers',
    headers: auth(userId),
    payload: { questionId, optionId, mode: 'TRAINING', clientAttemptId, ...extra },
  });
  return { status: res.statusCode, body: res.json() as AnswerResultDTO };
}

describe('Telegram initData', () => {
  it('принимает корректно подписанные данные', () => {
    const v = verifyInitData(initData(42), BOT_TOKEN, 3600);
    expect(v.user.id).toBe(42);
  });

  it('отклоняет подмену пользователя', () => {
    const raw = new URLSearchParams(initData(42));
    raw.set('user', JSON.stringify({ id: 1, first_name: 'Хакер' }));
    expect(() => verifyInitData(raw.toString(), BOT_TOKEN, 3600)).toThrow(InitDataValidationError);
  });

  it('отклоняет подпись чужим токеном и устаревшие данные', () => {
    expect(() => verifyInitData(initData(42, { token: '1:other' }), BOT_TOKEN, 3600)).toThrow(/bad-hash/);
    const old = initData(42, { authDate: Math.floor(Date.now() / 1000) - 7200 });
    expect(() => verifyInitData(old, BOT_TOKEN, 3600)).toThrow(/expired/);
  });

  it('без initData — 401, Telegram ID из параметров не принимается', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/me?telegramId=777000111' });
    expect(r.statusCode).toBe(401);
    const r2 = await t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'tma user=%7B%22id%22%3A1%7D&hash=' + 'a'.repeat(64) } });
    expect(r2.statusCode).toBe(401);
  });
});

describe('учебный сценарий', () => {
  let ticket: TicketDTO;
  let set: QuestionSetDTO;

  it('новый пользователь видит нулевую статистику', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(U1) });
    const me = r.json() as MeDTO;
    expect(me.user.xp).toBe(0);
    expect(me.stats.answeredQuestions).toBe(0);
    expect(me.user.isNew).toBe(true);
    expect(me.access.required).toBe(false);
  });

  it('билет отдаётся без признака правильного ответа', async () => {
    ticket = (await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(U1) })).json<TicketDTO[]>()[0];
    set = (await t.app.inject({ method: 'GET', url: `/api/sets/ticket/${ticket.id}`, headers: auth(U1) })).json();
    expect(set.questions.length).toBe(20);
    expect(JSON.stringify(set)).not.toContain('isCorrect');
  });

  it('правильность определяется сервером, клиентские поля игнорируются', async () => {
    const q = set.questions[0];
    const wrong = await correctOptionId(t.ctx, q.id, false);
    const r = await answer(U1, q.id, wrong, randomUUID(), { isCorrect: true, xp: 9999 });
    expect(r.status).toBe(200);
    expect(r.body.isCorrect).toBe(false);
    expect(r.body.xpAwarded).toBe(0);
    expect(r.body.explanation.correctOptionId).toBe(await correctOptionId(t.ctx, q.id));
  });

  it('XP за первый верный ответ начисляется один раз', async () => {
    const q = set.questions[1];
    const ok = await correctOptionId(t.ctx, q.id);
    const first = await answer(U1, q.id, ok);
    expect(first.body.isCorrect).toBe(true);
    expect(first.body.xpAwarded).toBeGreaterThanOrEqual(10); // + достижение «Первые шаги»
    const again = await answer(U1, q.id, ok);
    expect(again.body.isCorrect).toBe(true);
    expect(again.body.xpAwarded).toBe(0);
  });

  it('повторная отправка того же ответа идемпотентна', async () => {
    const q = set.questions[2];
    const ok = await correctOptionId(t.ctx, q.id);
    const id = randomUUID();
    const a = await answer(U1, q.id, ok, id);
    const b = await answer(U1, q.id, ok, id);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.xpAwarded).toBe(a.body.xpAwarded);
    expect(b.body.totalXp).toBe(a.body.totalXp);
    const count = await t.ctx.db.userAnswer.count({ where: { clientAttemptId: id } });
    expect(count).toBe(1);
  });

  it('неверный вариант другого вопроса отклоняется', async () => {
    const other = await correctOptionId(t.ctx, set.questions[4].id);
    const r = await answer(U1, set.questions[3].id, other);
    expect(r.status).toBe(400);
  });

  it('ошибки попадают в «Мои ошибки» и исправляются с бонусом', async () => {
    const mistakes = (await t.app.inject({ method: 'GET', url: '/api/sets/mistakes', headers: auth(U1) })).json<QuestionSetDTO>();
    expect(mistakes.questions.map((q) => q.id)).toContain(set.questions[0].id);
    const q = set.questions[0];
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/answers',
      headers: auth(U1),
      payload: { questionId: q.id, optionId: await correctOptionId(t.ctx, q.id), mode: 'MISTAKES', clientAttemptId: randomUUID() },
    });
    const body = res.json<AnswerResultDTO>();
    expect(body.isCorrect).toBe(true);
    expect(body.xpAwarded).toBe(10 + 5); // первый верный + исправление ошибки
    const after = (await t.app.inject({ method: 'GET', url: '/api/sets/mistakes', headers: auth(U1) })).json<QuestionSetDTO>();
    expect(after.questions.map((x) => x.id)).not.toContain(q.id);
  });

  it('прохождение билета до конца, повышение ранга и восстановление прогресса', async () => {
    let rankUp = null;
    for (const q of set.questions.slice(3)) {
      const r = await answer(U1, q.id, await correctOptionId(t.ctx, q.id), randomUUID(), { ticketId: ticket.id });
      if (r.body.rankUp) rankUp = r.body.rankUp;
    }
    const me = (await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(U1) })).json<MeDTO>();
    expect(me.user.xp).toBeGreaterThanOrEqual(100);
    expect(rankUp?.code).toBe('uchenitsa');
    expect(me.rank.current.code).toBe('uchenitsa');
    expect(me.stats.answeredQuestions).toBe(20);
    // «вход с другого устройства» = новая initData того же пользователя
    const tickets = (await t.app.inject({ method: 'GET', url: '/api/tickets', headers: { authorization: `tma ${initData(U1, { firstName: 'Новое имя' })}` } })).json<TicketDTO[]>();
    expect(tickets[0].answered).toBe(20);
    const rewards = await t.ctx.db.userReward.findMany({ where: { user: { telegramId: BigInt(U1) } } });
    expect(rewards.map((r) => r.rewardCode)).toEqual(expect.arrayContaining(['car-pink', 'sticker-joy', 'item-crown', 'sticker-hello']));
  });

  it('нельзя надеть не открытую машину', async () => {
    const r = await t.app.inject({ method: 'PUT', url: '/api/garage/car', headers: auth(U1), payload: { code: 'car-gold' } });
    expect(r.statusCode).toBe(403);
    const ok = await t.app.inject({ method: 'PUT', url: '/api/garage/car', headers: auth(U1), payload: { code: 'car-pink' } });
    expect(ok.statusCode).toBe(200);
  });
});

describe('экзамен', () => {
  const U = 5002;
  it('правила ГИБДД: ошибка добавляет 5 вопросов и 5 минут; верные доп. вопросы — сдано', async () => {
    const st = (await t.app.inject({ method: 'POST', url: '/api/exams', headers: auth(U), payload: { examCode: 'gibdd-abm' } })).json<ExamStateDTO>();
    expect(st.items).toHaveLength(20);
    expect(JSON.stringify(st)).not.toContain('isCorrect');
    const deadline0 = Date.parse(st.deadlineAt);
    let state = st;
    // первая ошибка — в первом вопросе
    for (const [i, it] of st.items.entries()) {
      const optionId = await correctOptionId(t.ctx, it.questionId, i !== 0);
      const r = await t.app.inject({ method: 'POST', url: `/api/exams/${st.id}/answers`, headers: auth(U), payload: { questionId: it.questionId, optionId } });
      expect(r.statusCode).toBe(200);
      state = r.json();
    }
    expect(state.status).toBe('IN_PROGRESS');
    expect(state.items).toHaveLength(25);
    expect(Date.parse(state.deadlineAt) - deadline0).toBe(5 * 60_000);
    const extras = state.items.filter((i) => i.extra);
    expect(extras.every((e) => e.block === st.items[0].block)).toBe(true);
    for (const e of extras) {
      const r = await t.app.inject({ method: 'POST', url: `/api/exams/${st.id}/answers`, headers: auth(U), payload: { questionId: e.questionId, optionId: await correctOptionId(t.ctx, e.questionId) } });
      state = r.json();
    }
    expect(state.status).toBe('PASSED');
    expect(state.correct).toBe(24);
    expect(state.xpAwarded).toBe(50);
  });

  it('ответ в экзамене нельзя изменить, повтор того же ответа безопасен', async () => {
    const st = (await t.app.inject({ method: 'POST', url: '/api/exams', headers: auth(U), payload: { examCode: 'mini' } })).json<ExamStateDTO>();
    const q = st.items[0].questionId;
    const ok = await correctOptionId(t.ctx, q);
    const bad = await correctOptionId(t.ctx, q, false);
    const a = await t.app.inject({ method: 'POST', url: `/api/exams/${st.id}/answers`, headers: auth(U), payload: { questionId: q, optionId: ok } });
    const b = await t.app.inject({ method: 'POST', url: `/api/exams/${st.id}/answers`, headers: auth(U), payload: { questionId: q, optionId: ok } });
    const c = await t.app.inject({ method: 'POST', url: `/api/exams/${st.id}/answers`, headers: auth(U), payload: { questionId: q, optionId: bad } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(c.statusCode).toBe(409);
    expect(await t.ctx.db.userAnswer.count({ where: { examAttemptId: st.id } })).toBe(1);
  });

  it('две ошибки в одном блоке — не сдано; разбор доступен после завершения', async () => {
    const active = (await t.app.inject({ method: 'GET', url: '/api/exams/active', headers: auth(U) })).json<{ attempt: ExamStateDTO }>().attempt;
    const early = await t.app.inject({ method: 'GET', url: `/api/exams/${active.id}/review`, headers: auth(U) });
    expect(early.statusCode).toBe(409);
    const block = [1, 2, 3, 4].find((b) => active.items.filter((i) => i.block === b && !i.answered).length >= 2)!;
    const sameBlock = active.items.filter((i) => i.block === block && !i.answered);
    let state = active;
    for (const it of sameBlock.slice(0, 2)) {
      state = (await t.app.inject({ method: 'POST', url: `/api/exams/${active.id}/answers`, headers: auth(U), payload: { questionId: it.questionId, optionId: await correctOptionId(t.ctx, it.questionId, false) } })).json();
    }
    expect(state.status).toBe('FAILED');
    expect(state.reason).toMatch(/одном тематическом блоке/);
    const review = await t.app.inject({ method: 'GET', url: `/api/exams/${active.id}/review`, headers: auth(U) });
    expect(review.statusCode).toBe(200);
  });

  it('чужую попытку открыть нельзя', async () => {
    const att = await t.ctx.db.examAttempt.findFirstOrThrow();
    const r = await t.app.inject({ method: 'GET', url: `/api/exams/${att.id}`, headers: auth(9999) });
    expect(r.statusCode).toBe(404);
  });
});

describe('обязательная подписка', () => {
  const U = 5003;
  it('выключена — доступ без проверки и без запросов в Telegram', async () => {
    t.checker.calls = 0;
    const r = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(U) });
    expect(r.statusCode).toBe(200);
    expect(t.checker.calls).toBe(0);
  });

  it('включена — защищённые операции закрыты до проверки', async () => {
    await t.ctx.db.requiredSubscription.create({ data: { kind: 'CHANNEL', chatId: '@zayush_test_channel', inviteUrl: 'https://t.me/zayush_test_channel', title: 'Канал' } });
    await t.ctx.settings.set('subscription', { enabled: true });
    t.checker.result = { kind: 'ok', status: 'left' };
    const me = (await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(U) })).json<MeDTO>();
    expect(me.access).toEqual({ required: true, passed: false });
    const r = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(U) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('SUBSCRIPTION_REQUIRED');
    const ans = await t.app.inject({ method: 'POST', url: '/api/answers', headers: auth(U), payload: {} });
    expect(ans.statusCode).toBe(403);
  });

  it('проверка не подписанного пользователя не пускает, chatId не раскрывается', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/gate/check', headers: auth(U) });
    const g = r.json();
    expect(g.passed).toBe(false);
    expect(g.state).toBe('missing');
    expect(JSON.stringify(g)).not.toContain('@zayush_test_channel');
  });

  it('подписался — проверка проходит, доступ открыт', async () => {
    t.checker.result = { kind: 'ok', status: 'member' };
    const g = (await t.app.inject({ method: 'POST', url: '/api/gate/check', headers: auth(U) })).json();
    expect(g.passed).toBe(true);
    const r = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(U) });
    expect(r.statusCode).toBe(200);
  });

  it('сбой Telegram API: новичку — 503 с понятной ошибкой, недавно проверенному — льготный доступ', async () => {
    t.checker.result = { kind: 'unavailable', description: 'timeout' };
    const g = (await t.app.inject({ method: 'POST', url: '/api/gate/check', headers: auth(5004) })).json();
    expect(g.state).toBe('unavailable');
    // У нового пользователя нет прошлых проверок — защищённые операции закрыты
    const r = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(5004) });
    expect(r.statusCode).toBe(403);
    // У U проверка была успешной: даже после истечения кэша сбой Telegram не блокирует
    await t.ctx.db.subscriptionCheck.updateMany({ where: { user: { telegramId: BigInt(U) } }, data: { validUntil: new Date(Date.now() - 1000) } });
    const r2 = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(U) });
    expect(r2.statusCode).toBe(200);
  });

  it('сбой Telegram при истёкшей проверке без льготы — 503', async () => {
    const user = await t.ctx.db.user.findUniqueOrThrow({ where: { telegramId: BigInt(U) } });
    await t.ctx.db.subscriptionCheck.updateMany({ where: { userId: user.id }, data: { checkedAt: new Date(Date.now() - 48 * 3600_000), validUntil: new Date(Date.now() - 1000) } });
    const r = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(U) });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('SUBSCRIPTION_CHECK_UNAVAILABLE');
    await t.ctx.settings.set('subscription', { enabled: false });
  });
});

describe('админка', () => {
  it('обычный пользователь не имеет доступа', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/admin/stats', headers: auth(U1) });
    expect(r.statusCode).toBe(403);
  });
  it('без авторизации и с неверным токеном — отказ', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/stats' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/stats', headers: { 'x-admin-token': 'wrong' } })).statusCode).toBe(401);
  });
  it('админ по Telegram ID из конфигурации сервера', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/admin/stats', headers: auth(ADMIN_TG) });
    expect(r.statusCode).toBe(200);
    expect(r.json().questions).toBe(800);
    expect(r.json().demoQuestions).toBe(0);
  });
  it('админ по ADMIN_API_TOKEN; вопрос с двумя правильными ответами отклоняется', async () => {
    const h = { 'x-admin-token': ADMIN_TOKEN };
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/admin/questions',
      headers: h,
      payload: {
        externalId: 'test-q',
        topicSlug: 'signs',
        text: 'Тестовый вопрос?',
        explanation: 'Тестовое объяснение длиннее десяти символов',
        clauseRefs: [],
        signRefs: [],
        isDemo: true,
        isPublished: false,
        options: [
          { text: 'a', isCorrect: true },
          { text: 'b', isCorrect: true },
        ],
      },
    });
    expect(bad.statusCode).toBe(400);
  });
  it('загрузка SVG запрещена', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const r = await t.app.inject({ method: 'POST', url: '/api/admin/upload', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { dataBase64: svg } });
    expect(r.statusCode).toBe(400);
  });
});

describe('ранги и подсказки', () => {
  it('база с рангами первой версии обновляется до рангов с картинок, награды выдаются по XP', async () => {
    const { seedDefaults } = await import('../src/services/content-import.js');
    const { LEGACY_RANK_CODES, DEFAULT_RANKS } = await import('@zayush/shared');
    await t.ctx.db.rank.deleteMany({});
    await t.ctx.db.rank.createMany({ data: LEGACY_RANK_CODES.map((code, i) => ({ code, title: code, minXp: i * 100, rewards: [] })) });
    const u = await t.ctx.db.user.create({ data: { telegramId: 6001n, firstName: 'Старичок', xp: 700 } });
    await seedDefaults(t.ctx.db);
    const ranks = await t.ctx.db.rank.findMany({ orderBy: { minXp: 'asc' } });
    expect(ranks.map((r) => r.title)).toEqual(DEFAULT_RANKS.map((r) => r.title));
    const rewards = (await t.ctx.db.userReward.findMany({ where: { userId: u.id } })).map((r) => r.rewardCode);
    expect(rewards).toEqual(expect.arrayContaining(['car-lilac', 'car-sky', 'sticker-tender']));
    expect(rewards).not.toContain('car-mint');
  });

  it('ранги, переименованные владельцем, не перезаписываются', async () => {
    const { seedDefaults } = await import('../src/services/content-import.js');
    await t.ctx.db.rank.update({ where: { code: 'novichok' }, data: { title: 'Свой ранг' } });
    await t.ctx.db.rank.create({ data: { code: 'custom', title: 'Своё', minXp: 9000, rewards: [] } });
    await seedDefaults(t.ctx.db);
    expect((await t.ctx.db.rank.findUniqueOrThrow({ where: { code: 'novichok' } })).title).toBe('Свой ранг');
  });

  it('подсказка есть в тренировке и скрыта в экзамене', async () => {
    const ticket = (await t.app.inject({ method: 'GET', url: '/api/tickets', headers: auth(7001) })).json<TicketDTO[]>()[0];
    const set = (await t.app.inject({ method: 'GET', url: `/api/sets/ticket/${ticket.id}`, headers: auth(7001) })).json<QuestionSetDTO>();
    expect(set.questions.some((q) => typeof q.hint === 'string' && q.hint.length > 5)).toBe(true);
    // В тренировке — текст в стиле «Заюш», в экзамене — официальная формулировка билета
    const official = await t.ctx.db.question.findFirstOrThrow({ where: { id: set.questions[0].id } });
    expect(set.questions[0].text).not.toBe(official.officialText);
    const ex = (await t.app.inject({ method: 'POST', url: '/api/exams', headers: auth(7001), payload: { examCode: 'mini' } })).json<ExamStateDTO>();
    expect(ex.questions.every((q) => q.hint === null)).toBe(true);
    for (const eq of ex.questions) {
      const row = await t.ctx.db.question.findUniqueOrThrow({ where: { id: eq.id } });
      expect(eq.text).toBe(row.officialText);
    }
  });
});
