import { formatPoints } from '@zayush/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Flag, Heart, Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { AnswerRequest, AnswerResultDTO, QuestionSetDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { Explanation, OptionButton, QuestionImage } from '../components/Question';
import { celebrate, useRankUp } from '../components/RankUp';
import { BunnyBubble, Button, Card, cx, DemoNotice, EmptyState, ErrorState, Modal, Pill, ScreenHeader, Skeleton } from '../components/ui';
import { api, ApiError, uuid } from '../lib/api';
import { useSay } from '../lib/hooks';
import { haptic } from '../lib/telegram';

type Kind = 'ticket' | 'topic' | 'mistakes' | 'favorites' | 'daily';

interface SavedResult {
  optionId: string;
  isCorrect: boolean;
  xp: number;
}
interface Session {
  index: number;
  results: Record<string, SavedResult>;
  done: boolean;
}

const MODE: Record<Kind, AnswerRequest['mode']> = {
  ticket: 'TRAINING',
  topic: 'TRAINING',
  favorites: 'TRAINING',
  daily: 'DAILY',
  mistakes: 'MISTAKES',
};

function loadSession(key: string): Session | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(key: string, s: Session) {
  try {
    sessionStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

export function Quiz() {
  const { kind = 'daily', id } = useParams<{ kind: Kind; id?: string }>();
  const path = kind === 'ticket' ? `/sets/ticket/${id}` : kind === 'topic' ? `/sets/topic/${id}` : `/sets/${kind}`;
  const sessionKey = `zayush:quiz:${kind}:${id ?? ''}`;
  const set = useQuery({ queryKey: ['set', kind, id], queryFn: () => api<QuestionSetDTO>(path), staleTime: Infinity, gcTime: 60_000 });

  if (set.isPending)
    return (
      <Page nav={false}>
        <ScreenHeader title="Загружаем…" back="/learn" />
        <Skeleton className="h-52 mt-2" />
        <Skeleton className="h-8 mt-4 w-3/4" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 mt-3" />
        ))}
      </Page>
    );
  if (set.isError)
    return (
      <Page nav={false}>
        <ScreenHeader title="Упс" back="/learn" />
        <ErrorState message={(set.error as ApiError).message} onRetry={() => set.refetch()} />
      </Page>
    );
  if (!set.data.questions.length)
    return (
      <Page nav={false}>
        <ScreenHeader title={set.data.title} back="/learn" />
        <EmptyState title="Здесь пока пусто" text="Вопросов в этой подборке нет." />
      </Page>
    );
  return <QuizRunner set={set.data} kind={kind} ticketId={kind === 'ticket' ? id : undefined} sessionKey={sessionKey} />;
}

function QuizRunner({ set, kind, ticketId, sessionKey }: { set: QuestionSetDTO; kind: Kind; ticketId?: string; sessionKey: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const say = useSay();
  const { showRankUp } = useRankUp();
  const questions = set.questions;

  const [session, setSession] = useState<Session>(() => {
    const saved = loadSession(sessionKey);
    if (saved && saved.index < questions.length) return saved;
    // «Продолжить»: в билетах и темах начинаем с первого нерешённого вопроса
    const firstNew = kind === 'ticket' || kind === 'topic' ? questions.findIndex((q) => !q.lastAnswer) : 0;
    return { index: firstNew > 0 ? firstNew : 0, results: {}, done: false };
  });
  useEffect(() => saveSession(sessionKey, session), [sessionKey, session]);

  const q = questions[session.index];
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResultDTO | null>(null);
  const [favorite, setFavorite] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const attemptId = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const explRef = useRef<HTMLDivElement>(null);
  const seed = useMemo(() => Math.floor(Math.random() * 100), [session.index]);

  useEffect(() => {
    setSelected(null);
    setResult(null);
    setHintOpen(false);
    attemptId.current = null;
    topRef.current?.scrollIntoView({ block: 'start' });
  }, [session.index]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const answer = useMutation({
    mutationFn: (body: AnswerRequest) => api<AnswerResultDTO>('/answers', { body }),
    onSuccess: (res) => {
      setResult(res);
      haptic(res.isCorrect ? 'success' : 'error');
      if (res.isCorrect && res.xpAwarded > 0) celebrate();
      setSession((s) => ({ ...s, results: { ...s.results, [q.id]: { optionId: selected!, isCorrect: res.isCorrect, xp: res.xpAwarded } } }));
      if (res.rankUp) setTimeout(() => showRankUp(res.rankUp!), 600);
      const notes: string[] = [];
      if (res.dailyCompleted) notes.push('Ежедневное задание выполнено! 🎉');
      if (res.ticketCompleted) notes.push('Билет пройден! Бонусные баллы 💗');
      for (const a of res.achievementsUnlocked) notes.push(`Достижение: ${a.title} 🏅`);
      if (notes.length) setToast(notes.join(' · '));
      qc.invalidateQueries({ queryKey: ['me'] });
      if (!res.isCorrect) setTimeout(() => explRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    },
  });

  const check = () => {
    if (!selected || answer.isPending) return;
    attemptId.current ??= uuid();
    answer.mutate({ questionId: q.id, optionId: selected, mode: MODE[kind], clientAttemptId: attemptId.current, ticketId });
  };

  const next = () => {
    haptic('light');
    if (session.index + 1 >= questions.length) setSession((s) => ({ ...s, done: true }));
    else setSession((s) => ({ ...s, index: s.index + 1 }));
  };

  const toggleFav = async () => {
    const cur = favorite[q.id] ?? q.isFavorite;
    setFavorite((f) => ({ ...f, [q.id]: !cur }));
    haptic('select');
    try {
      await api(`/questions/${q.id}/favorite`, { method: 'PUT', body: { favorite: !cur } });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch {
      setFavorite((f) => ({ ...f, [q.id]: cur }));
    }
  };

  if (session.done) {
    return (
      <Finish
        set={set}
        session={session}
        onRestart={() => setSession({ index: 0, results: {}, done: false })}
        onMistakes={() => {
          qc.removeQueries({ queryKey: ['set', 'mistakes'] });
          sessionStorage.removeItem('zayush:quiz:mistakes:');
          navigate('/quiz/mistakes');
        }}
      />
    );
  }

  const isFav = favorite[q.id] ?? q.isFavorite;
  const answered = !!result;
  const optionState = (oid: string) => {
    if (!result) return selected === oid ? 'selected' : 'idle';
    if (oid === result.explanation.correctOptionId) return 'correct';
    if (oid === selected) return 'wrong';
    return 'dim';
  };
  const title = kind === 'ticket' && q.ticket ? `Билет ${q.ticket.number}` : set.title;

  return (
    <Page nav={false}>
      <div ref={topRef} />
      <ScreenHeader
        title={title}
        back={kind === 'ticket' || kind === 'topic' ? '/learn' : -1}
        right={
          <Pill>
            {session.index + 1} из {questions.length}
          </Pill>
        }
      />
      {/* Прогресс: точки по вопросам */}
      <div className="flex gap-1 mb-3">
        {questions.map((qq, i) => {
          const r = session.results[qq.id];
          return (
            <div
              key={qq.id}
              className={cx(
                'h-1.5 flex-1 rounded-full',
                r ? (r.isCorrect ? 'bg-ok' : 'bg-bad') : i === session.index ? 'bg-pink' : 'bg-pink-200',
              )}
            />
          );
        })}
      </div>

      <QuestionImage url={q.imageUrl} alt={q.imageAlt} />

      <h2 className="mt-4 text-[18px] font-black leading-snug">{q.text}</h2>
      <div className="mt-1 text-[12px] font-bold text-muted">{q.topic.title}</div>

      <div className="mt-3 space-y-2.5">
        {q.options.map((o) => (
          <OptionButton
            key={o.id}
            label={o.label}
            text={o.text}
            state={optionState(o.id)}
            disabled={answered || answer.isPending}
            onClick={() => {
              setSelected(o.id);
              haptic('select');
            }}
          />
        ))}
      </div>

      {!answered ? (
        <BunnyBubble className="mt-4">
          {answer.isError ? (answer.error as ApiError).message : hintOpen && q.hint ? q.hint : say('question.hint', { seed })}
          {q.hint && !answer.isError ? (
            <button onClick={() => setHintOpen((v) => !v)} className="mt-1.5 flex items-center gap-1 text-[13px] font-extrabold text-pink">
              <Lightbulb className="size-4" /> {hintOpen ? 'Скрыть подсказку' : 'Подсказка'}
            </button>
          ) : null}
        </BunnyBubble>
      ) : result.isCorrect ? (
        <BunnyBubble className="mt-4" tone="ok" image="/brand/sticker-wink.webp">
          {say(result.xpAwarded > 0 ? 'answer.correct' : 'answer.correct.again', { seed })}
          {result.xpAwarded > 0 ? <span className="ml-1 inline-flex items-center gap-1 text-pink"><Sparkles className="size-4" />+{formatPoints(result.xpAwarded)}</span> : null}
        </BunnyBubble>
      ) : (
        <BunnyBubble className="mt-4" tone="bad" image="/brand/sticker-smile.webp">
          {say('answer.wrong', { seed })}
        </BunnyBubble>
      )}

      {answered ? (
        <div ref={explRef} className="mt-4 scroll-mt-20">
          <Explanation question={q} explanation={result.explanation} chosenOptionId={selected} defaultOpen={!result.isCorrect} />
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 px-4 pt-4 pb-[calc(var(--safe-bottom)+12px)] mt-4 bg-gradient-to-t from-pink-50 via-pink-50 to-pink-50/0">
        {!answered ? (
          <div className="flex gap-3">
            <button
              onClick={toggleFav}
              aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}
              className={cx('h-[52px] px-4 rounded-full border-2 font-extrabold flex items-center gap-1.5 bg-white', isFav ? 'border-pink text-pink' : 'border-pink-200 text-ink-soft')}
            >
              <Heart className={cx('size-5', isFav && 'fill-pink')} /> <span className="text-[14px]">{isFav ? 'В избранном' : 'В избранное'}</span>
            </button>
            <Button onClick={check} disabled={!selected} loading={answer.isPending} className="flex-1 w-auto">
              {answer.isError ? 'Отправить ещё раз' : 'Проверить'}
            </Button>
          </div>
        ) : (
          <Button onClick={next}>
            {result.isCorrect ? (session.index + 1 >= questions.length ? 'Посмотреть итог' : 'Следующий вопрос') : say('explain.done', { seed: 0 })}
            <ArrowRight className="size-5" />
          </Button>
        )}
        {answered ? (
          <button onClick={() => setReportOpen(true)} className="mt-2 w-full text-[12.5px] font-bold text-muted flex items-center justify-center gap-1">
            <Flag className="size-3.5" /> Нашли неточность в вопросе?
          </button>
        ) : null}
      </div>

      {toast ? (
        <div className="fixed top-[calc(var(--safe-top)+12px)] inset-x-4 z-50 mx-auto max-w-[480px] rounded-2xl bg-ink text-white px-4 py-3 font-bold text-[14px] shadow-lg animate-pop">
          {toast}
        </div>
      ) : null}
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} questionId={q.id} />
    </Page>
  );
}

function Finish({ set, session, onRestart, onMistakes }: { set: QuestionSetDTO; session: Session; onRestart: () => void; onMistakes: () => void }) {
  const navigate = useNavigate();
  const results = Object.values(session.results);
  const correct = results.filter((r) => r.isCorrect).length;
  const wrong = results.length - correct;
  const xp = results.reduce((s, r) => s + r.xp, 0);
  const great = wrong === 0 && results.length > 0;
  useEffect(() => {
    if (great) celebrate();
  }, [great]);
  return (
    <Page nav={false}>
      <ScreenHeader title={set.title} back="/learn" />
      <div className="text-center pt-2">
        <img src={great ? '/brand/sticker-wink.webp' : '/brand/sticker-hello.webp'} alt="" className="h-40 mx-auto object-contain animate-float" />
        <h2 className="mt-2 text-[26px] font-black text-pink">{great ? 'Без единой ошибки! 👑' : 'Готово, умничка! 💗'}</h2>
        <p className="mt-1 font-bold text-ink-soft">{great ? 'Красотка, это было идеально.' : 'Ошибки — это просто темы, которые стоит повторить.'}</p>
      </div>
      <Card className="mt-5 p-4 grid grid-cols-3 text-center">
        <div>
          <div className="text-[24px] font-black text-ok">{correct}</div>
          <div className="text-[12px] font-bold text-muted">верно</div>
        </div>
        <div>
          <div className="text-[24px] font-black text-bad">{wrong}</div>
          <div className="text-[12px] font-bold text-muted">ошибок</div>
        </div>
        <div>
          <div className="text-[24px] font-black text-pink">+{xp}</div>
          <div className="text-[12px] font-bold text-muted">Баллы</div>
        </div>
      </Card>
      {xp === 0 && results.length > 0 ? (
        <p className="mt-2 text-center text-[12px] font-semibold text-muted">Баллы даются за первый верный ответ на вопрос — повторение тренирует память 💗</p>
      ) : null}
      <div className="mt-5 space-y-3">
        {wrong > 0 ? (
          <Button onClick={onMistakes}>
            <RotateCcw className="size-5" /> Разобрать ошибки
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onRestart}>
          Пройти ещё раз
        </Button>
        <Button variant="ghost" onClick={() => navigate('/learn')}>
          К билетам
        </Button>
      </div>
      {set.isDemo ? <DemoNotice className="mt-5" /> : null}
    </Page>
  );
}

export function ReportModal({ open, onClose, questionId }: { open: boolean; onClose: () => void; questionId?: string }) {
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api('/reports', { body: { questionId, message: text } }),
    onSuccess: () => setText(''),
  });
  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        send.reset();
      }}
    >
      {send.isSuccess ? (
        <div className="text-center py-4">
          <img src="/brand/sticker-tender.webp" alt="" className="h-24 mx-auto" />
          <div className="mt-2 font-black text-lg">Спасибо, заюш!</div>
          <p className="font-semibold text-muted">Мы проверим вопрос по тексту ПДД и исправим, если нужно.</p>
          <Button className="mt-4" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      ) : (
        <div>
          <div className="font-black text-lg">Сообщить о неточности</div>
          <p className="text-[13px] font-semibold text-muted mt-1">Опиши, что не так: ответ, объяснение, картинка или номер пункта.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={1000}
            className="mt-3 w-full rounded-2xl border-2 border-pink-200 p-3 font-semibold outline-none focus:border-pink"
            placeholder="Например: на картинке не видно знака…"
          />
          {send.isError ? <p className="text-bad text-[13px] font-bold mt-1">{(send.error as ApiError).message}</p> : null}
          <Button className="mt-3" disabled={text.trim().length < 3} loading={send.isPending} onClick={() => send.mutate()}>
            Отправить
          </Button>
        </div>
      )}
    </Modal>
  );
}
