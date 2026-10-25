import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, getAdminToken, setAdminToken } from '../../lib/api';
import { Button, Card, Chips, cx, Pill, ProgressBar, Toggle } from '../../components/ui';

/**
 * Минимальная админ-панель. Доступ проверяется на сервере:
 *  - Telegram ID из ADMIN_TELEGRAM_IDS (при открытии через бота), или
 *  - X-Admin-Token = ADMIN_API_TOKEN (вход из обычного браузера).
 */
const A = <T,>(path: string, init: Parameters<typeof api>[1] = {}) => api<T>(`/admin${path}`, { ...init, admin: true });

type Tab = 'stats' | 'questions' | 'signs' | 'subs' | 'balance' | 'texts' | 'reports' | 'import';

export default function Admin() {
  const navigate = useNavigate();
  const who = useQuery({ queryKey: ['admin-who'], queryFn: () => A<{ admin: boolean }>('/whoami'), retry: false });
  const [tab, setTab] = useState<Tab>('stats');
  const [view, setView] = useState<'main' | 'activity'>('main');
  const [detailMetric, setDetailMetric] = useState<string | null>(null);

  if (who.isPending) return <Shell>Проверяем доступ…</Shell>;
  if (who.isError) return <Login onDone={() => who.refetch()} error={(who.error as ApiError).status === 403 ? 'Нет доступа' : null} />;

  if (view === 'activity' && detailMetric) {
    return <ActivityDetail metric={detailMetric} onBack={() => { setView('main'); setDetailMetric(null); }} />;
  }

  return (
    <Shell>
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/profile')} className="size-10 grid place-items-center rounded-full bg-white border border-pink-200">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-[22px] font-black flex-1">Админ-панель</h1>
        {getAdminToken() ? (
          <Button size="sm" variant="ghost" onClick={() => { setAdminToken(null); who.refetch(); }}>
            Выйти
          </Button>
        ) : null}
      </div>
      <Chips
        className="mt-3"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'stats', label: 'Обзор' },
          { value: 'questions', label: 'Вопросы' },
          { value: 'signs', label: 'Знаки' },
          { value: 'subs', label: 'Подписка' },
          { value: 'balance', label: 'Баллы и ранги' },
          { value: 'texts', label: 'Тексты' },
          { value: 'reports', label: 'Жалобы' },
          { value: 'import', label: 'Импорт' },
        ]}
      />
      <div className="mt-4">
        {tab === 'stats' && <Stats onOpenDetail={(m) => { setDetailMetric(m); setView('activity'); }} />}
        {tab === 'questions' && <Questions />}
        {tab === 'signs' && <SignsAdmin />}
        {tab === 'subs' && <Subscriptions />}
        {tab === 'balance' && <Balance />}
        {tab === 'texts' && <Texts />}
        {tab === 'reports' && <Reports />}
        {tab === 'import' && <ImportTab />}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[860px] px-4 pt-[calc(var(--safe-top)+var(--content-top)+16px)] pb-16 min-h-dvh">{children}</div>;
}

function Login({ onDone, error }: { onDone: () => void; error: string | null }) {
  const [token, setToken] = useState('');
  return (
    <Shell>
      <Card className="p-5 max-w-[420px] mx-auto mt-10">
        <h1 className="text-xl font-black">Вход в админ-панель</h1>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Откройте приложение из Telegram под аккаунтом из ADMIN_TELEGRAM_IDS или введите ADMIN_API_TOKEN.
        </p>
        {error ? <p className="mt-2 text-bad font-bold">{error}</p> : null}
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={inputCls + ' mt-3'} placeholder="ADMIN_API_TOKEN" />
        <Button className="mt-3" onClick={() => { setAdminToken(token.trim()); onDone(); }} disabled={token.trim().length < 8}>
          Войти
        </Button>
      </Card>
    </Shell>
  );
}

const inputCls = 'w-full rounded-xl border-2 border-pink-100 bg-white px-3 py-2 font-semibold outline-none focus:border-pink';
const labelCls = 'block text-[12px] font-extrabold text-muted mb-1 mt-3';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function ErrorLine({ e }: { e: unknown }) {
  return e ? <p className="mt-2 text-bad font-bold text-[13px]">{(e as ApiError).message}</p> : null;
}

// ───────── Обзор ─────────
interface ActivityRow {
  id: string;
  userId: string;
  firstName: string;
  telegramId: string;
  isNew: boolean;
  isActiveNow: boolean;
  startedAt: string;
  lastSeenAt: string;
  durationMin: number;
}

function Stats({ onOpenDetail }: { onOpenDetail: (metric: string) => void }) {
  const q = useQuery({ queryKey: ['admin-stats'], queryFn: () => A<Record<string, number | unknown>>('/stats') });
  const [onlineOpen, setOnlineOpen] = useState(false);
  const online = useQuery({ queryKey: ['admin-online'], queryFn: () => A<ActivityRow[]>('/activity?limit=100&hours=1&activeNow=true'), enabled: onlineOpen, refetchInterval: onlineOpen ? 30000 : false });
  if (!q.data) return <p>Загрузка…</p>;
  const d = q.data as Record<string, number> & {
    hardest: { externalId: string; text: string; mistakes: number }[];
    dailyActivity: { day: string; users: number; answers: number }[];
    topTopics: { title: string; questions: number; answers: number; correct: number; accuracy: number }[];
  };
  const cells: { k: string; v: number; metric?: string }[] = [
    { k: 'Пользователи', v: d.users, metric: 'users' },
    { k: 'Новых за 7 дн.', v: d.newUsers7, metric: 'newUsers7' },
    { k: 'Новых сегодня', v: d.newToday, metric: 'newToday' },
    { k: 'Сейчас активны', v: d.activeNow, metric: 'activeNow' },
    { k: 'Активны сегодня', v: d.activeToday, metric: 'activeToday' },
    { k: 'Активны за 7 дн.', v: d.active7, metric: 'active7' },
    { k: 'Активны за 30 дн.', v: d.active30, metric: 'active30' },
    { k: 'Ответов всего', v: d.answers },
    { k: 'Ответов за 7 дн.', v: d.answers7 },
    { k: 'Вопросов опубликовано', v: d.questions },
    { k: 'Из них демо', v: d.demoQuestions },
    { k: 'Экзаменов', v: d.exams },
    { k: 'Сдано', v: d.examsPassed },
    { k: 'Ошибок открыто', v: d.mistakesOpen },
    { k: 'Ошибок всего', v: d.mistakesTotal },
    { k: 'Избранного', v: d.favorites },
    { k: 'Сессий за 7 дн.', v: d.sessions7, metric: 'sessions7' },
    { k: 'Ср. время сессии, мин', v: d.avgSessionMinutes7 },
    { k: 'Открытых жалоб', v: d.openReports },
  ];
  const maxAnswers = Math.max(1, ...d.dailyActivity.map((x) => x.answers));
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {cells.map(({ k, v, metric }) => (
          <Card
            key={k}
            className={`p-3 ${metric ? 'cursor-pointer hover:ring-2 hover:ring-pink/40' : ''}`}
            onClick={metric ? () => onOpenDetail(metric) : undefined}
          >
            <div className="text-[22px] font-black text-pink">{v}</div>
            <div className="text-[11.5px] font-bold text-muted">{k}{metric ? ' ↗' : ''}</div>
          </Card>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2 cursor-pointer select-none" onClick={() => setOnlineOpen((v) => !v)}>
        <h3 className="font-black">Онлайн сейчас</h3>
        <span className="text-[12px] font-bold text-muted">({d.activeNow})</span>
        <ChevronDown className={`size-4 text-muted transition-transform ${onlineOpen ? 'rotate-180' : ''}`} />
      </div>
      {onlineOpen ? (
        <Card className="mt-2 p-3">
          {online.isPending ? <p className="text-[12px] text-muted">Загрузка…</p> : null}
          {online.isError ? <p className="text-[12px] text-bad">Ошибка загрузки</p> : null}
          <div className="space-y-1.5 max-h-60 overflow-auto">
            {online.data?.map((a) => {
              const t = new Date(a.lastSeenAt);
              const time = t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 text-[12.5px] font-semibold">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-block size-2 rounded-full bg-green-500" />
                    <span className="truncate">{a.firstName}</span>
                    <span className="text-muted tabular-nums text-[11px]">({a.telegramId})</span>
                    {a.isNew ? <Pill tone="gold">новый</Pill> : null}
                  </div>
                  <span className="text-muted tabular-nums shrink-0">{time} · {a.durationMin} мин</span>
                </div>
              );
            })}
            {!online.isPending && !online.data?.length ? <p className="text-[12px] text-muted">Никого нет онлайн</p> : null}
          </div>
        </Card>
      ) : null}

      <h3 className="mt-5 font-black">Активность за 14 дней</h3>
      <Card className="mt-2 p-3">
        <div className="flex items-end gap-1 h-32">
          {d.dailyActivity.map((x) => (
            <div key={x.day} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                <div className="w-full bg-pink/80 rounded-t" style={{ height: `${(x.answers / maxAnswers) * 100}%`, minHeight: x.answers ? 2 : 0 }} title={`${x.answers} ответов`} />
              </div>
              <div className="text-[9px] font-bold text-muted rotate-[-45deg] origin-top-left whitespace-nowrap">{x.day.slice(5)}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 text-[11.5px] font-semibold text-muted">Столбцы — ответы. Активные пользователи по дням: {d.dailyActivity.map((x) => x.users).join(', ')}</div>
      </Card>

      <h3 className="mt-5 font-black">Топ тем по ответам</h3>
      <div className="mt-2 space-y-2">
        {d.topTopics.map((t) => (
          <Card key={t.title} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-extrabold text-[13px] truncate">{t.title}</div>
              <Pill tone={t.accuracy >= 80 ? 'ok' : 'pink'}>{t.accuracy}%</Pill>
            </div>
            <div className="mt-1 text-[12px] font-bold text-muted">
              вопросов: {t.questions} · ответов: {t.answers} · верно: {t.correct}
            </div>
            <ProgressBar value={t.answers ? t.correct / t.answers : 0} className="h-1.5 mt-1.5" color="ok" />
          </Card>
        ))}
      </div>

      <h3 className="mt-5 font-black">Самые сложные вопросы</h3>
      <div className="mt-2 space-y-2">
        {d.hardest.map((h) => (
          <Card key={h.externalId} className="p-3 text-[13px] font-semibold">
            <Pill tone="bad">{h.mistakes} ошибок</Pill> <b>{h.externalId}</b> — {h.text}
          </Card>
        ))}
      </div>
    </>
  );
}

// ───────── Вопросы ─────────
interface AdminQuestionRow {
  id: string;
  externalId: string;
  text: string;
  isDemo: boolean;
  isPublished: boolean;
  verifiedAt: string | null;
  topic: { slug: string; title: string };
  ticket: { number: number; setCode: string } | null;
  _count: { reports: number; mistakes: number };
}

function Questions() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-questions', search], queryFn: () => A<AdminQuestionRow[]>(`/questions?search=${encodeURIComponent(search)}`) });
  if (editing) return <QuestionEditor id={editing} onClose={() => { setEditing(null); list.refetch(); }} />;
  return (
    <>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Поиск по тексту или externalId" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button size="md" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Новый
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {list.data?.map((q) => (
          <Card key={q.id} className="p-3" onClick={() => setEditing(q.id)}>
            <div className="flex flex-wrap gap-1.5 items-center">
              <b className="text-[13px]">{q.externalId}</b>
              <Pill tone="sky">{q.topic.title}</Pill>
              {q.ticket ? <Pill>Билет {q.ticket.number}</Pill> : null}
              {q.isDemo ? <Pill tone="gold">демо</Pill> : null}
              {!q.isPublished ? <Pill tone="ink">снят</Pill> : null}
              {q._count.reports ? <Pill tone="bad">жалоб: {q._count.reports}</Pill> : null}
            </div>
            <div className="mt-1 text-[14px] font-semibold">{q.text}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

interface QForm {
  externalId: string;
  topicSlug: string;
  ticketId: string | null;
  ticketPosition: number | null;
  scene: string;
  hint: string;
  text: string;
  imageUrl: string;
  imageAlt: string;
  explanation: string;
  takeaway: string;
  clauseRefs: string;
  signRefs: string;
  sourceUrl: string;
  isDemo: boolean;
  isPublished: boolean;
  verified: boolean;
  options: { text: string; isCorrect: boolean; whyWrong: string }[];
}

function QuestionEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const topics = useQuery({ queryKey: ['admin-topics'], queryFn: () => A<{ id: string; slug: string; title: string }[]>('/topics') });
  const tickets = useQuery({ queryKey: ['admin-tickets'], queryFn: () => A<{ id: string; number: number; title: string; setCode: string }[]>('/tickets') });
  const [f, setF] = useState<QForm | null>(
    id === 'new'
      ? {
          externalId: '',
          topicSlug: 'signs',
          ticketId: null,
          ticketPosition: null,
          scene: '',
          hint: '',
          text: '',
          imageUrl: '',
          imageAlt: '',
          explanation: '',
          takeaway: '',
          clauseRefs: '',
          signRefs: '',
          sourceUrl: 'https://www.consultant.ru/document/cons_doc_LAW_2709/',
          isDemo: false,
          isPublished: false,
          verified: false,
          options: [
            { text: '', isCorrect: true, whyWrong: '' },
            { text: '', isCorrect: false, whyWrong: '' },
            { text: '', isCorrect: false, whyWrong: '' },
          ],
        }
      : null,
  );
  const q = useQuery({
    queryKey: ['admin-question', id],
    enabled: id !== 'new',
    queryFn: () => A<Record<string, unknown> & { options: { text: string; isCorrect: boolean; whyWrong: string | null }[]; topic: { slug: string } }>(`/questions/${id}`),
  });
  useEffect(() => {
    if (q.data && !f) {
      const d = q.data as never as Record<string, string | string[] | boolean | number | null> & { options: { text: string; isCorrect: boolean; whyWrong: string | null }[]; topic: { slug: string } };
      setF({
        externalId: d.externalId as string,
        topicSlug: d.topic.slug,
        ticketId: (d.ticketId as string) ?? null,
        ticketPosition: (d.ticketPosition as number) ?? null,
        scene: (d.scene as string) ?? '',
        hint: (d.hint as string) ?? '',
        text: d.text as string,
        imageUrl: (d.imageUrl as string) ?? '',
        imageAlt: (d.imageAlt as string) ?? '',
        explanation: d.explanation as string,
        takeaway: (d.takeaway as string) ?? '',
        clauseRefs: (d.clauseRefs as string[]).join(', '),
        signRefs: (d.signRefs as string[]).join(', '),
        sourceUrl: (d.sourceUrl as string) ?? '',
        isDemo: d.isDemo as boolean,
        isPublished: d.isPublished as boolean,
        verified: !!d.verifiedAt,
        options: d.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect, whyWrong: o.whyWrong ?? '' })),
      });
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f!,
        scene: f!.scene || null,
        hint: f!.hint || null,
        imageUrl: f!.imageUrl || null,
        imageAlt: f!.imageAlt || null,
        takeaway: f!.takeaway || null,
        sourceUrl: f!.sourceUrl || null,
        clauseRefs: f!.clauseRefs.split(',').map((s) => s.trim()).filter(Boolean),
        signRefs: f!.signRefs.split(',').map((s) => s.trim()).filter(Boolean),
        options: f!.options.map((o) => ({ ...o, whyWrong: o.whyWrong || null })),
      };
      return id === 'new' ? A('/questions', { body }) : A(`/questions/${id}`, { method: 'PUT', body });
    },
    onSuccess: onClose,
  });
  const unpublish = useMutation({ mutationFn: () => A(`/questions/${id}`, { method: 'DELETE' }), onSuccess: onClose });

  if (!f) return <p>Загрузка…</p>;
  const set = <K extends keyof QForm>(k: K, v: QForm[K]) => setF({ ...f, [k]: v });

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <button onClick={onClose} className="size-9 grid place-items-center rounded-full bg-pink-100">
          <ArrowLeft className="size-4" />
        </button>
        <h2 className="font-black text-lg flex-1">{id === 'new' ? 'Новый вопрос' : f.externalId}</h2>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label="externalId (латиница, дефис)">
          <input className={inputCls} value={f.externalId} onChange={(e) => set('externalId', e.target.value)} />
        </Field>
        <Field label="Тема">
          <select className={inputCls} value={f.topicSlug} onChange={(e) => set('topicSlug', e.target.value)}>
            {topics.data?.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Билет">
          <select className={inputCls} value={f.ticketId ?? ''} onChange={(e) => set('ticketId', e.target.value || null)}>
            <option value="">— без билета —</option>
            {tickets.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.setCode} · {t.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Позиция в билете">
          <input type="number" className={inputCls} value={f.ticketPosition ?? ''} onChange={(e) => set('ticketPosition', e.target.value ? Number(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Смешная сценка (не влияет на смысл)">
        <textarea className={inputCls} rows={2} value={f.scene} onChange={(e) => set('scene', e.target.value)} />
      </Field>
      <Field label="Подсказка (наводит на правило, но не называет ответ)">
        <input className={inputCls} value={f.hint} onChange={(e) => set('hint', e.target.value)} />
      </Field>
      <Field label="Текст вопроса">
        <textarea className={inputCls} rows={2} value={f.text} onChange={(e) => set('text', e.target.value)} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label="Изображение (URL: /pdd/abm/…, /pdd/signs/…, /uploads/…)">
          <input className={inputCls} value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} />
        </Field>
        <Field label="Описание изображения (alt)">
          <input className={inputCls} value={f.imageAlt} onChange={(e) => set('imageAlt', e.target.value)} />
        </Field>
      </div>
      {f.imageUrl ? <img src={f.imageUrl} alt="" className="mt-2 h-32 rounded-xl border border-pink-100" /> : null}
      <ImageUpload onUploaded={(url) => set('imageUrl', url)} />

      <span className={labelCls}>Варианты ответа (ровно один правильный)</span>
      <div className="space-y-2">
        {f.options.map((o, i) => (
          <div key={i} className={cx('rounded-xl border-2 p-2', o.isCorrect ? 'border-ok bg-ok-soft' : 'border-pink-100')}>
            <div className="flex gap-2 items-center">
              <input type="radio" checked={o.isCorrect} onChange={() => set('options', f.options.map((x, j) => ({ ...x, isCorrect: j === i })))} />
              <input className={inputCls} placeholder={`Вариант ${i + 1}`} value={o.text} onChange={(e) => set('options', f.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              {f.options.length > 2 ? (
                <button onClick={() => set('options', f.options.filter((_, j) => j !== i))} className="text-bad">
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
            {!o.isCorrect ? (
              <input className={inputCls + ' mt-1.5 text-[13px]'} placeholder="Почему этот вариант неверен" value={o.whyWrong} onChange={(e) => set('options', f.options.map((x, j) => (j === i ? { ...x, whyWrong: e.target.value } : x)))} />
            ) : null}
          </div>
        ))}
        {f.options.length < 5 ? (
          <Button size="sm" variant="ghost" onClick={() => set('options', [...f.options, { text: '', isCorrect: false, whyWrong: '' }])}>
            <Plus className="size-3.5" /> вариант
          </Button>
        ) : null}
      </div>
      <Field label="Серьёзное объяснение (по тексту ПДД)">
        <textarea className={inputCls} rows={5} value={f.explanation} onChange={(e) => set('explanation', e.target.value)} />
      </Field>
      <Field label="«Запомни» — короткий вывод">
        <input className={inputCls} value={f.takeaway} onChange={(e) => set('takeaway', e.target.value)} />
      </Field>
      <div className="grid sm:grid-cols-3 gap-x-3">
        <Field label="Пункты ПДД (через запятую)">
          <input className={inputCls} value={f.clauseRefs} onChange={(e) => set('clauseRefs', e.target.value)} placeholder="10.2, 12.4" />
        </Field>
        <Field label="Знаки (через запятую)">
          <input className={inputCls} value={f.signRefs} onChange={(e) => set('signRefs', e.target.value)} placeholder="5.16" />
        </Field>
        <Field label="Источник (URL)">
          <input className={inputCls} value={f.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 font-bold text-[14px]">
        <label className="flex items-center gap-2"><Toggle checked={f.isPublished} onChange={(v) => set('isPublished', v)} /> Опубликован</label>
        <label className="flex items-center gap-2"><Toggle checked={f.isDemo} onChange={(v) => set('isDemo', v)} /> Демо</label>
        <label className="flex items-center gap-2"><Toggle checked={f.verified} onChange={(v) => set('verified', v)} /> Проверен по ПДД</label>
      </div>
      <ErrorLine e={save.error} />
      <div className="mt-4 flex gap-2">
        <Button size="md" onClick={() => save.mutate()} loading={save.isPending}>
          <Save className="size-4" /> Сохранить
        </Button>
        {id !== 'new' ? (
          <Button size="md" variant="secondary" onClick={() => unpublish.mutate()}>
            Снять с публикации
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function ImageUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const up = useMutation({
    mutationFn: async (file: File) => {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] ?? '');
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      return A<{ url: string }>('/upload', { body: { dataBase64: b64 } });
    },
    onSuccess: (r) => onUploaded(r.url),
  });
  return (
    <label className="mt-2 inline-flex items-center gap-2 text-[13px] font-extrabold text-pink cursor-pointer">
      <Upload className="size-4" /> {up.isPending ? 'Загружаем…' : 'Загрузить PNG/JPEG/WebP (до 2 МБ)'}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} />
      <ErrorLine e={up.error} />
    </label>
  );
}

// ───────── Знаки ─────────
interface AdminSign {
  id: string;
  code: string;
  title: string;
  category: string;
  description: string;
  example: string | null;
  imageUrl: string;
  imageVerified: boolean;
  isPublished: boolean;
}
function SignsAdmin() {
  const list = useQuery({ queryKey: ['admin-signs'], queryFn: () => A<AdminSign[]>('/signs') });
  const [edit, setEdit] = useState<AdminSign | null>(null);
  const save = useMutation({
    mutationFn: (s: AdminSign) =>
      A(`/signs/${s.id}`, { method: 'PUT', body: { title: s.title, description: s.description, example: s.example, imageUrl: s.imageUrl, imageVerified: s.imageVerified, isPublished: s.isPublished } }),
    onSuccess: () => {
      setEdit(null);
      list.refetch();
    },
  });
  if (edit)
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <img src={edit.imageUrl} alt="" className="h-16" />
          <b className="text-lg">{edit.code}</b>
        </div>
        <Field label="Название">
          <input className={inputCls} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
        </Field>
        <Field label="Значение (по Приложению 1 к ПДД)">
          <textarea className={inputCls} rows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
        </Field>
        <Field label="Милый пример">
          <input className={inputCls} value={edit.example ?? ''} onChange={(e) => setEdit({ ...edit, example: e.target.value || null })} />
        </Field>
        <Field label="Изображение">
          <input className={inputCls} value={edit.imageUrl} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} />
        </Field>
        <ImageUpload onUploaded={(url) => setEdit({ ...edit, imageUrl: url })} />
        <div className="mt-3 flex gap-4 font-bold text-[14px]">
          <label className="flex items-center gap-2"><Toggle checked={edit.imageVerified} onChange={(v) => setEdit({ ...edit, imageVerified: v })} /> Сверено с ГОСТ</label>
          <label className="flex items-center gap-2"><Toggle checked={edit.isPublished} onChange={(v) => setEdit({ ...edit, isPublished: v })} /> Опубликован</label>
        </div>
        <ErrorLine e={save.error} />
        <div className="mt-4 flex gap-2">
          <Button size="md" onClick={() => save.mutate(edit)} loading={save.isPending}>Сохранить</Button>
          <Button size="md" variant="secondary" onClick={() => setEdit(null)}>Отмена</Button>
        </div>
      </Card>
    );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {list.data?.map((s) => (
        <Card key={s.id} className="p-2.5 text-center" onClick={() => setEdit(s)}>
          <img src={s.imageUrl} alt="" className="h-14 mx-auto" />
          <div className="text-[12px] font-extrabold mt-1">{s.code}</div>
          <div className="text-[12px] font-semibold leading-tight">{s.title}</div>
          {!s.imageVerified ? <Pill tone="gold" className="mt-1">сверить с ГОСТ</Pill> : null}
        </Card>
      ))}
    </div>
  );
}

// ───────── Подписка ─────────
interface Source {
  id: string;
  kind: 'CHANNEL' | 'GROUP';
  chatId: string;
  inviteUrl: string;
  title: string;
  isActive: boolean;
}
function Subscriptions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-subs'], queryFn: () => A<{ enabled: boolean; effective: boolean; sources: Source[]; botConfigured: boolean }>('/subscriptions') });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => A('/subscriptions/enabled', { method: 'PUT', body: { enabled } }), onSuccess: () => q.refetch() });
  const [form, setForm] = useState<Omit<Source, 'id'> & { id?: string }>({ kind: 'CHANNEL', chatId: '', inviteUrl: '', title: '', isActive: true });
  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = form;
      return id ? A(`/subscriptions/${id}`, { method: 'PUT', body }) : A('/subscriptions', { body });
    },
    onSuccess: () => {
      setForm({ kind: 'CHANNEL', chatId: '', inviteUrl: '', title: '', isActive: true });
      q.refetch();
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => A(`/subscriptions/${id}`, { method: 'DELETE' }), onSuccess: () => q.refetch() });
  if (!q.data) return <p>Загрузка…</p>;
  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-black">Обязательная подписка</div>
            <div className="text-[13px] font-semibold text-muted">
              {q.data.effective ? 'Включена — новые пользователи увидят экран проверки.' : q.data.enabled ? 'Флаг включён, но нет активных источников — проверка не работает.' : 'Выключена — все входят без проверки.'}
            </div>
          </div>
          <Toggle checked={q.data.enabled} onChange={(v) => toggle.mutate(v)} />
        </div>
        {!q.data.botConfigured ? <p className="mt-2 text-bad font-bold text-[13px]">BOT_TOKEN не задан — проверка подписки невозможна.</p> : null}
        <p className="mt-2 text-[12px] font-semibold text-muted">
          Бот должен быть добавлен в каждый канал администратором, а в группу — участником (лучше администратором), иначе Telegram не отдаст статус участника.
        </p>
      </Card>
      <div className="mt-3 space-y-2">
        {q.data.sources.map((s) => (
          <Card key={s.id} className="p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-extrabold">{s.title} {!s.isActive ? <Pill tone="ink">выкл</Pill> : null}</div>
              <div className="text-[12px] font-semibold text-muted truncate">
                {s.kind === 'CHANNEL' ? 'Канал' : 'Группа'} · {s.chatId} · {s.inviteUrl}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setForm(s)}>Изменить</Button>
            <button onClick={() => del.mutate(s.id)} className="text-bad p-2"><Trash2 className="size-4" /></button>
          </Card>
        ))}
      </div>
      <Card className="mt-3 p-4">
        <div className="font-black">{form.id ? 'Изменить источник' : 'Добавить источник'}</div>
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Тип">
            <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Source['kind'] })}>
              <option value="CHANNEL">Канал</option>
              <option value="GROUP">Группа / супергруппа</option>
            </select>
          </Field>
          <Field label="Название для пользователя">
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="chatId: @username или -100…">
            <input className={inputCls} value={form.chatId} onChange={(e) => setForm({ ...form, chatId: e.target.value.trim() })} />
          </Field>
          <Field label="Ссылка (для закрытых — приглашение)">
            <input className={inputCls} value={form.inviteUrl} onChange={(e) => setForm({ ...form, inviteUrl: e.target.value.trim() })} placeholder="https://t.me/..." />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 font-bold text-[14px]"><Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} /> Активен</label>
        <ErrorLine e={save.error} />
        <Button size="md" className="mt-3" onClick={() => save.mutate()} loading={save.isPending}>Сохранить</Button>
      </Card>
    </>
  );
}

// ───────── XP и ранги ─────────
function Balance() {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => A<{ xp: Record<string, number>; ranks: unknown[] }>('/settings') });
  const [xp, setXp] = useState<Record<string, number> | null>(null);
  const [ranks, setRanks] = useState('');
  useEffect(() => {
    if (q.data) {
      setXp(q.data.xp);
      setRanks(JSON.stringify(q.data.ranks, null, 2));
    }
  }, [q.data]);
  const saveXp = useMutation({ mutationFn: () => A('/settings/xp', { method: 'PUT', body: xp }) });
  const saveRanks = useMutation({ mutationFn: () => A('/settings/ranks', { method: 'PUT', body: JSON.parse(ranks) }) });
  const LABELS: Record<string, string> = {
    firstCorrect: 'Первый верный ответ на вопрос',
    mistakeFixed: 'Исправление ошибки',
    ticketCompleted: 'Билет пройден',
    dailyChallenge: 'Ежедневное задание',
    dailyGoal: 'Вопросов в ежедневном задании',
    examPassed: 'Экзамен сдан (1 раз в день)',
  };
  if (!xp) return <p>Загрузка…</p>;
  return (
    <>
      <Card className="p-4">
        <div className="font-black">Баланс баллов</div>
        <div className="grid sm:grid-cols-2 gap-x-3">
          {Object.entries(xp).map(([k, v]) => (
            <Field key={k} label={LABELS[k] ?? k}>
              <input type="number" min={0} className={inputCls} value={v} onChange={(e) => setXp({ ...xp, [k]: Number(e.target.value) })} />
            </Field>
          ))}
        </div>
        <ErrorLine e={saveXp.error} />
        <Button size="md" className="mt-3" onClick={() => saveXp.mutate()} loading={saveXp.isPending}>
          {saveXp.isSuccess ? 'Сохранено ✓' : 'Сохранить'}
        </Button>
      </Card>
      <Card className="mt-3 p-4">
        <div className="font-black">Ранги (JSON)</div>
        <p className="text-[12px] font-semibold text-muted">code, title, minXp, tagline, image, rewards[]. Нужен ранг с minXp = 0.</p>
        <textarea className={inputCls + ' mt-2 font-mono text-[12px]'} rows={16} value={ranks} onChange={(e) => setRanks(e.target.value)} />
        <ErrorLine e={saveRanks.error} />
        <Button size="md" className="mt-3" onClick={() => saveRanks.mutate()} loading={saveRanks.isPending}>
          {saveRanks.isSuccess ? 'Сохранено ✓' : 'Сохранить ранги'}
        </Button>
      </Card>
    </>
  );
}

// ───────── Тексты ─────────
function Texts() {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => A<{ texts: Record<string, string[]>; textDefaults: Record<string, string[]> }>('/settings') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) {
      const d: Record<string, string> = {};
      for (const k of Object.keys(q.data.textDefaults)) d[k] = (q.data.texts[k] ?? q.data.textDefaults[k]).join('\n');
      setDraft(d);
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(draft)) {
        const lines = v.split('\n').map((s) => s.trim()).filter(Boolean);
        const def = q.data!.textDefaults[k];
        if (lines.length && lines.join('\n') !== def.join('\n')) body[k] = lines;
      }
      return A('/settings/texts', { method: 'PUT', body });
    },
  });
  return (
    <>
      <p className="text-[13px] font-semibold text-muted">Каждая строка — отдельный вариант фразы. Приложение выбирает вариант случайно, чтобы общение не было однообразным.</p>
      <div className="mt-2 space-y-2">
        {Object.entries(draft).map(([k, v]) => (
          <Field key={k} label={k}>
            <textarea className={inputCls + ' text-[13px]'} rows={Math.min(5, v.split('\n').length + 1)} value={v} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <ErrorLine e={save.error} />
      <Button size="md" className="mt-3" onClick={() => save.mutate()} loading={save.isPending}>
        {save.isSuccess ? 'Сохранено ✓' : 'Сохранить тексты'}
      </Button>
    </>
  );
}

// ───────── Жалобы ─────────
interface Report {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  question: { externalId: string; text: string } | null;
  user: { firstName: string };
}
function Reports() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'REJECTED'>('OPEN');
  const q = useQuery({ queryKey: ['admin-reports', status], queryFn: () => A<Report[]>(`/reports?status=${status}`) });
  const upd = useMutation({ mutationFn: (p: { id: string; status: string }) => A(`/reports/${p.id}`, { method: 'PUT', body: { status: p.status } }), onSuccess: () => q.refetch() });
  return (
    <>
      <Chips value={status} onChange={setStatus} items={[{ value: 'OPEN', label: 'Открытые' }, { value: 'RESOLVED', label: 'Исправлено' }, { value: 'REJECTED', label: 'Отклонено' }]} />
      <div className="mt-3 space-y-2">
        {q.data?.length === 0 ? <p className="text-muted font-bold">Жалоб нет 💗</p> : null}
        {q.data?.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="text-[12px] font-bold text-muted">
              {new Date(r.createdAt).toLocaleString('ru-RU')} · {r.user.firstName} {r.question ? `· ${r.question.externalId}` : ''}
            </div>
            {r.question ? <div className="text-[13px] font-semibold text-ink-soft mt-1">{r.question.text}</div> : null}
            <div className="mt-1 font-bold">{r.message}</div>
            {status === 'OPEN' ? (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => upd.mutate({ id: r.id, status: 'RESOLVED' })}>Исправлено</Button>
                <Button size="sm" variant="secondary" onClick={() => upd.mutate({ id: r.id, status: 'REJECTED' })}>Отклонить</Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}

// ───────── Импорт ─────────
function ImportTab() {
  const [json, setJson] = useState('');
  const run = useMutation({ mutationFn: () => A<Record<string, unknown>>('/import', { body: JSON.parse(json) }) });
  return (
    <Card className="p-4">
      <div className="font-black">Импорт вопросов (JSON)</div>
      <p className="text-[13px] font-semibold text-muted">
        Формат — как в content/abm/content.json (см. docs/content-import.md). Вопросы обновляются по externalId, прогресс пользователей сохраняется.
      </p>
      <label className="mt-2 inline-flex items-center gap-2 text-[13px] font-extrabold text-pink cursor-pointer">
        <Upload className="size-4" /> Выбрать файл
        <input type="file" accept="application/json" className="hidden" onChange={async (e) => e.target.files?.[0] && setJson(await e.target.files[0].text())} />
      </label>
      <textarea className={inputCls + ' mt-2 font-mono text-[12px]'} rows={10} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"topics": [...], "questions": [...]}' />
      <ErrorLine e={run.error} />
      {run.data ? <pre className="mt-2 text-[12px] bg-pink-50 rounded-xl p-2 overflow-auto">{JSON.stringify(run.data, null, 2)}</pre> : null}
      <Button size="md" className="mt-3" disabled={!json.trim()} loading={run.isPending} onClick={() => run.mutate()}>
        Импортировать
      </Button>
    </Card>
  );
}
function metricParams(metric: string): string {
  switch (metric) {
    case 'newToday': return 'limit=500&hours=24&newOnly=true';
    case 'newUsers7': return 'limit=500&hours=168&newOnly=true';
    case 'activeNow': return 'limit=500&hours=1&activeNow=true';
    case 'activeToday': return 'limit=500&hours=24';
    case 'active7': return 'limit=500&hours=168';
    case 'active30': return 'limit=500&hours=168';
    case 'sessions7': return 'limit=500&hours=168';
    case 'users': return 'limit=500&hours=168';
    default: return 'limit=500&hours=24';
  }
}

function metricTitle(metric: string): string {
  const map: Record<string, string> = {
    users: 'Все пользователи',
    newUsers7: 'Новые за 7 дней',
    newToday: 'Новые сегодня',
    activeNow: 'Сейчас активны',
    activeToday: 'Активны сегодня',
    active7: 'Активны за 7 дней',
    active30: 'Активны за 30 дней',
    sessions7: 'Сессии за 7 дней',
  };
  return map[metric] ?? 'Детали';
}

function ActivityDetail({ metric, onBack }: { metric: string; onBack: () => void }) {
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('today');
  const [groupBy, setGroupBy] = useState<'day' | 'hour' | 'minute'>('hour');
  const hours = period === 'today' ? 24 : period === '7d' ? 168 : 720;
  const params = `${metricParams(metric).replace(/hours=\d+/, `hours=${hours}`)}&groupBy=${groupBy}`;
  const q = useQuery({ queryKey: ['admin-activity-detail', params], queryFn: () => A<{ timeline: { period: string; count: number; users: number }[]; sessions: ActivityRow[] }>(`/activity?${params}`), refetchInterval: 30000 });
  const timeline = q.data?.timeline ?? [];
  const sessions = q.data?.sessions ?? [];
  const maxCount = Math.max(1, ...timeline.map((t) => t.count));
  return (
    <Shell>
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="size-10 grid place-items-center rounded-full bg-white border border-pink-200">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-[22px] font-black flex-1">{metricTitle(metric)}</h1>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chips value={period} onChange={(v) => setPeriod(v as 'today' | '7d' | '30d')} items={[
          { value: 'today', label: 'Сегодня' },
          { value: '7d', label: '7 дней' },
          { value: '30d', label: '30 дней' },
        ]} />
        <Chips value={groupBy} onChange={(v) => setGroupBy(v as 'day' | 'hour' | 'minute')} items={[
          { value: 'day', label: 'По дням' },
          { value: 'hour', label: 'По часам' },
          { value: 'minute', label: 'По минутам' },
        ]} />
      </div>

      <Card className="mt-4 p-3">
        <div className="text-[13px] font-black mb-2">Диаграмма активности</div>
        {q.isPending ? <p className="text-[12px] text-muted">Загрузка…</p> : null}
        {q.isError ? <p className="text-[12px] text-bad">Ошибка загрузки</p> : null}
        <div className="flex items-end gap-1 h-32">
          {timeline.map((t) => (
            <div key={t.period} className="flex-1 flex flex-col items-center gap-1" title={`${t.period}: ${t.count} входов, ${t.users} польз.`}>
              <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                <div className="w-full bg-pink/80 rounded-t" style={{ height: `${(t.count / maxCount) * 100}%`, minHeight: t.count ? 2 : 0 }} />
              </div>
              <div className="text-[8px] font-bold text-muted rotate-[-45deg] origin-top-left whitespace-nowrap">{t.period.slice(-5)}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 text-[11.5px] font-semibold text-muted">Всего входов: {sessions.length}</div>
      </Card>

      <Card className="mt-3 p-3">
        <div className="text-[13px] font-black mb-2">Список по минутам</div>
        <div className="space-y-1.5 max-h-[50vh] overflow-auto">
          {sessions.map((a) => {
            const t = new Date(a.startedAt);
            const time = t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
            const date = t.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' });
            return (
              <div key={a.id} className="flex items-center justify-between gap-2 text-[12.5px] font-semibold border-b border-pink-50 pb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-muted tabular-nums">{date} {time}</span>
                  <span className="truncate">{a.firstName}</span>
                  <span className="text-muted tabular-nums text-[11px]">({a.telegramId})</span>
                  {a.isNew ? <Pill tone="gold">новый</Pill> : null}
                  {a.isActiveNow ? <span className="inline-block size-2 rounded-full bg-green-500" title="Сейчас активен" /> : null}
                </div>
                <span className="text-muted tabular-nums shrink-0">{a.durationMin} мин</span>
              </div>
            );
          })}
          {!q.isPending && !sessions.length ? <p className="text-[12px] text-muted">Нет данных</p> : null}
        </div>
      </Card>
    </Shell>
  );
}