import { formatPoints } from '@zayush/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, CheckCircle2, ChevronRight, CircleX, Clock3, FileQuestion, ListChecks, ShieldCheck, Timer, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ExamConfigDTO, ExamResultReviewDTO, ExamStateDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { Explanation, OptionButton, QuestionImage } from '../components/Question';
import { celebrate } from '../components/RankUp';
import { BunnyBubble, Button, Card, cx, DemoNotice, ErrorState, Pill, ScreenHeader, Segmented, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatTime, plural, useSay } from '../lib/hooks';
import { enableClosingConfirmation, haptic, showConfirm } from '../lib/telegram';

interface HistoryItem {
  id: string;
  title: string;
  status: string;
  correct: number;
  wrong: number;
  startedAt: string;
  durationSec: number | null;
  reason: string | null;
}

export function ExamHome() {
  const navigate = useNavigate();
  const say = useSay();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'mode' | 'history'>('mode');
  const configs = useQuery({ queryKey: ['exam-configs'], queryFn: () => api<ExamConfigDTO[]>('/exams') });
  const active = useQuery({ queryKey: ['exam-active'], queryFn: () => api<{ attempt: ExamStateDTO | null }>('/exams/active') });
  const history = useQuery({ queryKey: ['exam-history'], queryFn: () => api<HistoryItem[]>('/exams/history'), enabled: tab === 'history' });
  const [code, setCode] = useState('gibdd-abm');
  const start = useMutation({
    mutationFn: (examCode: string) => api<ExamStateDTO>('/exams', { body: { examCode } }),
    onSuccess: (st) => {
      qc.setQueryData(['exam', st.id], st);
      navigate(`/exam/${st.id}`);
    },
  });
  const cfg = configs.data?.find((c) => c.code === code);

  return (
    <Page>
      <ScreenHeader title="Экзамен" back="/learn" />
      <Segmented
        value={tab}
        onChange={setTab}
        items={[
          { value: 'mode', label: 'Режим' },
          { value: 'history', label: 'История' },
        ]}
      />

      {tab === 'mode' ? (
        <>
          <Card className="mt-4 p-5 text-center overflow-hidden relative">
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-pink-100 to-transparent" />
            <img src="/brand/car-black.webp" alt="" className="relative w-[62%] max-w-[230px] mx-auto drop-shadow-lg" />
            <h2 className="relative mt-3 text-[21px] font-black">Экзаменационный режим</h2>
            <p className="relative mt-1 text-[14px] font-bold text-ink-soft">{say('exam.intro', { seed: 0 })}</p>
          </Card>

          {active.data?.attempt ? (
            <Card className="mt-3 p-4 border-pink" onClick={() => navigate(`/exam/${active.data!.attempt!.id}`)}>
              <div className="flex items-center gap-3">
                <AlarmClock className="size-6 text-pink" />
                <div className="flex-1">
                  <div className="font-black">Есть незавершённый экзамен</div>
                  <div className="text-[12.5px] font-bold text-muted">Таймер идёт — вернись и закончи</div>
                </div>
                <ChevronRight className="size-5 text-pink" />
              </div>
            </Card>
          ) : null}

          <div className="mt-3 space-y-2">
            {configs.isPending ? <Skeleton className="h-20" /> : null}
            {configs.data?.map((c) => (
              <button
                key={c.code}
                onClick={() => setCode(c.code)}
                className={cx('w-full text-left rounded-[var(--radius-tile)] border-2 p-3.5 bg-white transition', code === c.code ? 'border-pink shadow-[0_0_0_4px_rgb(255_47_145_/_0.1)]' : 'border-pink-100')}
              >
                <div className="flex items-center justify-between">
                  <div className="font-black">{c.title}</div>
                  {code === c.code ? <CheckCircle2 className="size-5 text-pink" /> : null}
                </div>
                <div className="text-[12.5px] font-bold text-muted mt-0.5">{c.description}</div>
                {!c.available ? <div className="text-[12px] font-bold text-bad mt-1">{c.unavailableReason}</div> : null}
              </button>
            ))}
          </div>

          {cfg ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Rule icon={<FileQuestion className="size-5" />} value={cfg.questions} label={plural(cfg.questions, 'вопрос', 'вопроса', 'вопросов')} />
              <Rule icon={<Timer className="size-5" />} value={`${cfg.minutes} мин`} label="время" />
              <Rule icon={<ShieldCheck className="size-5" />} value={`≤ ${cfg.maxErrors}`} label="ошибки в разных блоках" />
            </div>
          ) : null}

          <Card className="mt-3 p-4">
            <div className="font-black flex items-center gap-2">
              <ListChecks className="size-5 text-pink" /> Правила, как в ГИБДД
            </div>
            <ul className="mt-2 space-y-1.5 text-[13.5px] font-semibold text-ink-soft list-disc pl-5">
              <li>Вопросы разбиты на 4 тематических блока.</li>
              <li>Ошибка → дополнительные вопросы из того же блока и дополнительное время.</li>
              <li>Две ошибки в одном блоке, больше двух ошибок или ошибка в дополнительных вопросах — не сдано.</li>
              <li>Ответ фиксируется сразу, подсказок и объяснений во время экзамена нет — разбор после.</li>
            </ul>
          </Card>

          {start.isError ? <p className="mt-3 text-bad font-bold text-[14px]">{(start.error as ApiError).message}</p> : null}
          <Button className="mt-4" disabled={!cfg?.available} loading={start.isPending} onClick={() => start.mutate(code)}>
            Начать экзамен →
          </Button>
          <p className="mt-3 text-center text-[11.5px] font-semibold text-muted">
            Тренировка в приложении не гарантирует сдачу официального экзамена. Параметры режима — по правилам ГИБДД (ПП РФ № 1097, приказ МВД № 80).
          </p>
          {cfg?.demo ? <DemoNotice className="mt-3" /> : null}
        </>
      ) : (
        <div className="mt-4 space-y-2.5">
          {history.isPending ? <Skeleton className="h-20" /> : null}
          {history.data?.length === 0 ? <p className="text-center font-bold text-muted py-10">Пока ни одной попытки. Самое время начать 💅</p> : null}
          {history.data?.map((h) => (
            <Card key={h.id} className="p-3.5" onClick={() => navigate(`/exam/${h.id}/result`)}>
              <div className="flex items-center gap-3">
                {h.status === 'PASSED' ? <CheckCircle2 className="size-7 text-ok" /> : <CircleX className="size-7 text-bad" />}
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold">{h.status === 'PASSED' ? 'Сдано' : h.status === 'EXPIRED' ? 'Время вышло' : 'Не сдано'} · {h.title}</div>
                  <div className="text-[12px] font-bold text-muted">
                    {new Date(h.startedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {h.correct} верно, {h.wrong} ошибок
                    {h.durationSec ? ` · ${formatTime(h.durationSec)}` : ''}
                  </div>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

function Rule({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl bg-white border border-pink-100 p-2.5 text-center shadow-[var(--shadow-card)]">
      <div className="mx-auto size-8 rounded-full bg-pink-100 text-pink grid place-items-center">{icon}</div>
      <div className="mt-1 font-black text-[16px]">{value}</div>
      <div className="text-[11px] font-bold text-muted leading-tight">{label}</div>
    </div>
  );
}

export function ExamRun() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamStateDTO>(`/exams/${id}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const st = state.data;
  const skew = useMemo(() => (st ? Date.parse(st.serverNow) - Date.now() : 0), [st?.serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    enableClosingConfirmation(true);
    return () => enableClosingConfirmation(false);
  }, []);

  const answer = useMutation({
    mutationFn: (b: { questionId: string; optionId: string }) => api<ExamStateDTO>(`/exams/${id}/answers`, { body: b }),
    onSuccess: (s) => {
      qc.setQueryData(['exam', id], s);
      haptic('light');
      setSelected(null);
      setIndex(null);
    },
    onError: () => {
      haptic('error');
      state.refetch();
    },
  });
  const finish = useMutation({
    mutationFn: () => api<ExamStateDTO>(`/exams/${id}/finish`, { method: 'POST' }),
    onSuccess: (s) => qc.setQueryData(['exam', id], s),
  });

  useEffect(() => {
    if (st && st.status !== 'IN_PROGRESS') {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['exam-active'] });
      navigate(`/exam/${id}/result`, { replace: true });
    }
  }, [st?.status]);

  const remainingSec = st ? (Date.parse(st.deadlineAt) - (now + skew)) / 1000 : 0;
  useEffect(() => {
    if (st?.status === 'IN_PROGRESS' && remainingSec <= 0) state.refetch();
  }, [remainingSec <= 0]);

  if (state.isPending)
    return (
      <Page nav={false}>
        <Skeleton className="h-10 mt-6" />
        <Skeleton className="h-52 mt-4" />
      </Page>
    );
  if (state.isError || !st)
    return (
      <Page nav={false}>
        <ScreenHeader title="Экзамен" back="/exam" />
        <ErrorState message={(state.error as ApiError)?.message ?? 'Ошибка'} onRetry={() => state.refetch()} />
      </Page>
    );

  const firstUnanswered = st.items.findIndex((i) => !i.answered);
  const cur = index ?? (firstUnanswered === -1 ? 0 : firstUnanswered);
  const item = st.items[cur];
  const q = st.questions.find((x) => x.id === item?.questionId);
  const answeredCount = st.items.filter((i) => i.answered).length;
  const extraCount = st.items.filter((i) => i.extra).length;

  return (
    <Page nav={false}>
      <header className="sticky top-0 z-20 -mx-4 px-4 pt-[calc(var(--safe-top)+var(--content-top)+10px)] pb-3 bg-pink-50/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className={cx('flex items-center gap-1.5 rounded-full px-3 h-9 font-black tabular-nums', remainingSec < 120 ? 'bg-bad text-white' : 'bg-ink text-white')}>
            <Clock3 className="size-4" /> {formatTime(remainingSec)}
          </div>
          <div className="flex-1 text-center font-black">
            Вопрос {cur + 1}/{st.items.length}
          </div>
          <button
            onClick={async () => {
              if (await showConfirm('Завершить экзамен? Неотвеченные вопросы засчитаются как ошибки.')) finish.mutate();
            }}
            className="h-9 px-3 rounded-full bg-white border border-pink-200 text-[13px] font-extrabold text-ink-soft"
          >
            Завершить
          </button>
        </div>
        <div className="mt-2.5 flex gap-1 overflow-x-auto no-scrollbar">
          {st.items.map((it, i) => (
            <button
              key={it.questionId}
              onClick={() => !it.answered && setIndex(i)}
              className={cx(
                'shrink-0 size-7 rounded-lg text-[11px] font-black',
                i === cur ? 'bg-pink text-white' : it.answered ? 'bg-ink/80 text-white' : 'bg-white border border-pink-200 text-ink-soft',
                it.extra && 'ring-2 ring-gold',
              )}
              aria-label={`Вопрос ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </header>

      {extraCount > 0 ? (
        <div className="mb-3 rounded-2xl bg-[#fff6d6] border border-[#ffe69a] px-3.5 py-2.5 text-[13px] font-bold text-[#7a5a00] flex gap-2">
          <TriangleAlert className="size-4 shrink-0 mt-0.5" /> Добавлены дополнительные вопросы ({extraCount}) и время. Здесь ошибаться нельзя — соберись, королева.
        </div>
      ) : null}

      {q && item && !item.answered ? (
        <>
          <QuestionImage url={q.imageUrl} alt={q.imageAlt} />
          <h2 className="mt-4 text-[18px] font-black leading-snug">{q.text}</h2>
          <div className="mt-3 space-y-2.5">
            {q.options.map((o) => (
              <OptionButton key={o.id} label={o.label} text={o.text} state={selected === o.id ? 'selected' : 'idle'} disabled={answer.isPending} onClick={() => setSelected(o.id)} />
            ))}
          </div>
          {answer.isError ? <p className="mt-3 text-bad font-bold text-[14px]">{(answer.error as ApiError).message}</p> : null}
          <div className="sticky bottom-0 -mx-4 px-4 pt-4 pb-[calc(var(--safe-bottom)+12px)] mt-4 bg-gradient-to-t from-pink-50 via-pink-50 to-pink-50/0">
            <Button disabled={!selected} loading={answer.isPending} onClick={() => selected && answer.mutate({ questionId: q.id, optionId: selected })}>
              Ответить
            </Button>
            <div className="mt-2 text-center text-[12px] font-bold text-muted">
              Отвечено {answeredCount} из {st.items.length}
            </div>
          </div>
        </>
      ) : (
        <div className="py-16 text-center font-bold text-muted">Подсчитываем результат…</div>
      )}
    </Page>
  );
}

export function ExamResult() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const say = useSay();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamStateDTO>(`/exams/${id}`) });
  const finished = state.data && state.data.status !== 'IN_PROGRESS';
  const review = useQuery({ queryKey: ['exam-review', id], queryFn: () => api<ExamResultReviewDTO[]>(`/exams/${id}/review`), enabled: !!finished });
  const [showAll, setShowAll] = useState(false);
  const passed = state.data?.status === 'PASSED';
  useEffect(() => {
    if (passed) celebrate();
  }, [passed]);
  const restart = useMutation({
    mutationFn: () => api<ExamStateDTO>('/exams', { body: { examCode: state.data!.examCode } }),
    onSuccess: (st) => {
      qc.setQueryData(['exam', st.id], st);
      navigate(`/exam/${st.id}`, { replace: true });
    },
  });

  if (state.isPending) return <Page nav={false}><Skeleton className="h-60 mt-8" /></Page>;
  if (state.isError || !state.data) return <Page nav={false}><ErrorState message="Не удалось загрузить результат" onRetry={() => state.refetch()} /></Page>;
  const st = state.data;
  const elapsed = Math.round((Date.parse(st.finishedAt ?? st.deadlineAt) - Date.parse(st.startedAt)) / 1000);
  const wrongList = (review.data ?? []).filter((r) => r.isCorrect !== true);
  const list = showAll ? review.data ?? [] : wrongList;

  return (
    <Page nav={false}>
      <ScreenHeader title="Результат экзамена" back="/exam" />
      <div className="text-center">
        <img src={passed ? '/brand/bunny-car.webp' : '/brand/sticker-hello.webp'} alt="" className={cx('mx-auto object-contain', passed ? 'w-[70%] max-w-[260px]' : 'h-40')} />
        <h2 className={cx('mt-2 text-[30px] font-black', passed ? 'text-pink' : 'text-ink')}>{passed ? 'Ты сдала! 💗' : 'Не сдано'}</h2>
        {!passed && st.reason ? <Pill tone="bad" className="mt-1">{st.reason}</Pill> : null}
      </div>
      <Card className="mt-4 p-4 space-y-2 text-[15px] font-bold">
        <Row k="Правильных ответов" v={`${st.correct} / ${st.items.length}`} />
        <Row k="Ошибок" v={String(st.wrong)} />
        <Row k="Время" v={formatTime(elapsed)} />
        {st.xpAwarded ? <Row k="Награда" v={`+${formatPoints(st.xpAwarded)}`} /> : null}
      </Card>
      <BunnyBubble className="mt-4" tone={passed ? 'ok' : 'white'}>
        {passed ? say('exam.passed', { seed: 0 }) : say('exam.failed', { seed: 0 })}
      </BunnyBubble>

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="md" className="flex-1" onClick={() => restart.mutate()} loading={restart.isPending}>
          Пройти заново
        </Button>
        <Button variant="ghost" size="md" className="flex-1" onClick={() => navigate('/quiz/mistakes')}>
          Мои ошибки
        </Button>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="font-black text-[17px]">{showAll ? 'Все вопросы' : 'Разбор ошибок'}</h3>
        <button className="text-[13px] font-extrabold text-pink" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Только ошибки' : 'Показать все'}
        </button>
      </div>
      <div className="mt-2 space-y-4">
        {review.isPending ? <Skeleton className="h-40" /> : null}
        {review.data && !list.length ? <p className="text-center font-bold text-muted py-6">Ошибок нет — королева! 👑</p> : null}
        {list.map((r, i) => (
          <Card key={r.questionId} className="p-4">
            <div className="flex items-center gap-2 text-[12px] font-extrabold">
              {r.isCorrect ? <Pill tone="ok">верно</Pill> : r.isCorrect === false ? <Pill tone="bad">ошибка</Pill> : <Pill tone="ink">без ответа</Pill>}
              <span className="text-muted">#{i + 1}</span>
            </div>
            {r.imageUrl ? <div className="mt-2"><QuestionImage url={r.imageUrl} alt={null} /></div> : null}
            <div className="mt-2 font-black leading-snug">{r.text}</div>
            <div className="mt-2 space-y-2">
              {r.options.map((o) => (
                <OptionButton
                  key={o.id}
                  label={o.label}
                  text={o.text}
                  disabled
                  state={o.id === r.explanation.correctOptionId ? 'correct' : o.id === r.chosenOptionId ? 'wrong' : 'dim'}
                />
              ))}
            </div>
            <div className="mt-3">
              <Explanation question={r} explanation={r.explanation} chosenOptionId={r.chosenOptionId} defaultOpen={false} />
            </div>
          </Card>
        ))}
      </div>
      {st.isDemo ? <DemoNotice className="mt-5" /> : null}
    </Page>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-soft">{k}</span>
      <span>{v}</span>
    </div>
  );
}
