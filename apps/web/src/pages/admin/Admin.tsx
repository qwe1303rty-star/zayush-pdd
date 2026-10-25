import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, getAdminToken, setAdminToken } from '../../lib/api';
import { formatPoints } from '@zayush/shared';
import { Button, Card, Chips, cx, Pill, Toggle } from '../../components/ui';

/**
 * Минимальная админ-панель. Доступ проверяется на сервере:
 *  - Telegram ID из ADMIN_TELEGRAM_IDS (при открытии через бота), или
 *  - X-Admin-Token = ADMIN_API_TOKEN (вход из обычного браузера).
 */
const A = <T,>(path: string, init: Parameters<typeof api>[1] = {}) => api<T>(`/admin${path}`, { ...init, admin: true });

type Tab = 'stats' | 'users' | 'questions' | 'signs' | 'subs' | 'balance' | 'texts' | 'reports' | 'import';

export default function Admin() {
  const navigate = useNavigate();
  const who = useQuery({ queryKey: ['admin-who'], queryFn: () => A<{ admin: boolean }>('/whoami'), retry: false });
  const [tab, setTab] = useState<Tab>('stats');

  if (who.isPending) return <Shell>Проверяем доступ…</Shell>;
  if (who.isError) return <Login onDone={() => who.refetch()} error={(who.error as ApiError).status === 403 ? 'Нет доступа' : null} />;

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
          { value: 'users', label: 'Пользователи' },
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
        {tab === 'stats' && <Stats />}
        {tab === 'users' && <Users />}
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

interface StatsDTO {
  users: number;
  active7: number;
  newToday: number;
  new7: number;
  answers: number;
  answers7: number;
  questions: number;
  demoQuestions: number;
  exams: number;
  examsPassed: number;
  openReports: number;
  activityTracking: boolean;
  onlineNow: number | null;
  peakDay: { users: number; at: string } | null;
  peakWeek: { users: number; at: string } | null;
  onlineWindowMin: number;
  hardest: { externalId: string; text: string; mistakes: number }[];
}

// ───────── Обзор ─────────
function Stats() {
  const q = useQuery({ queryKey: ['admin-stats'], queryFn: () => A<StatsDTO>('/stats'), refetchInterval: 30_000 });
  if (!q.data) return <p>Загрузка…</p>;
  const d = q.data;
  const cells: [string, number | string][] = [
    ['Пользователей всего', d.users],
    ['Новых сегодня', d.newToday],
    ['Новых за 7 дней', d.new7],
    ['Активны за 7 дней', d.active7],
    ['Ответов всего', d.answers],
    ['Ответов за 7 дней', d.answers7],
    ['Вопросов опубликовано', d.questions],
    ['Экзаменов', d.exams],
    ['Открытых жалоб', d.openReports],
  ];
  return (
    <>
      {d.activityTracking ? (
        <div className="grid grid-cols-3 gap-2.5">
          <Card className="p-3">
            <div className="text-[24px] font-black text-ok flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-ok animate-pulse" />
              {d.onlineNow ?? 0}
            </div>
            <div className="text-[12px] font-bold text-muted">Онлайн сейчас</div>
            <div className="text-[10px] font-bold text-muted mt-0.5">за {d.onlineWindowMin} мин</div>
          </Card>
          <Card className="p-3">
            <div className="text-[24px] font-black text-pink">{d.peakDay?.users ?? 0}</div>
            <div className="text-[12px] font-bold text-muted">Пик за день</div>
          </Card>
          <Card className="p-3">
            <div className="text-[24px] font-black text-pink">{d.peakWeek?.users ?? 0}</div>
            <div className="text-[12px] font-bold text-muted">Пик за неделю</div>
          </Card>
        </div>
      ) : (
        <Card className="p-3 text-[12.5px] font-semibold text-muted">
          Статистика онлайна и посещаемости выключена. Включите <code>ACTIVITY_TRACKING=true</code> — это учёт времени входов (ПДн, отражён в политике).
        </Card>
      )}
      {d.activityTracking ? <ActivityChart /> : null}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {cells.map(([k, v]) => (
          <Card key={k} className="p-3">
            <div className="text-[24px] font-black text-pink">{v}</div>
            <div className="text-[12px] font-bold text-muted">{k}</div>
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

// ───────── Диаграмма (SVG, без зависимостей) ─────────
const MSK = (iso: string) => new Date(iso);
function fmt(iso: string, unit: 'minute' | 'hour' | 'day') {
  const o: Intl.DateTimeFormatOptions =
    unit === 'day' ? { day: '2-digit', month: '2-digit' } : unit === 'hour' ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat('ru-RU', { ...o, timeZone: 'Europe/Moscow' }).format(MSK(iso));
}

function BarChart({ points, unit, valueKey = 'users', height = 120 }: { points: { t: string; users?: number; pings?: number }[]; unit: 'minute' | 'hour' | 'day'; valueKey?: 'users' | 'pings'; height?: number }) {
  if (!points.length) return <p className="text-[13px] font-semibold text-muted py-6 text-center">Пока нет данных за период.</p>;
  const vals = points.map((p) => p[valueKey] ?? 0);
  const max = Math.max(1, ...vals);
  const step = Math.ceil(points.length / 8);
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-[3px]" style={{ height, minWidth: points.length * 10 }}>
        {points.map((p, i) => {
          const v = p[valueKey] ?? 0;
          return (
            <div key={p.t} className="flex-1 min-w-[6px] flex flex-col items-center justify-end group relative">
              <div className="w-full rounded-t bg-gradient-to-t from-pink to-[#ff7ab8]" style={{ height: `${(v / max) * (height - 18)}px` }} title={`${fmt(p.t, unit)}: ${v}`} />
              <div className="text-[8px] font-bold text-muted mt-1 h-3 overflow-hidden whitespace-nowrap">{i % step === 0 ? fmt(p.t, unit) : ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityChart() {
  const [range, setRange] = useState<'day' | 'week'>('day');
  const q = useQuery({ queryKey: ['admin-activity', range], queryFn: () => A<{ unit: 'hour' | 'day'; points: { t: string; users: number; pings: number }[] }>(`/activity?range=${range}`) });
  return (
    <Card className="mt-3 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-black text-[15px]">Посещаемость</h3>
        <Chips value={range} onChange={setRange} items={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }]} />
      </div>
      <p className="text-[11px] font-bold text-muted mt-1">Уникальные пользователи по {range === 'day' ? 'часам' : 'дням'} (МСК)</p>
      <div className="mt-2">{q.data ? <BarChart points={q.data.points} unit={q.data.unit} /> : <p className="text-[13px] text-muted py-6">Загрузка…</p>}</div>
    </Card>
  );
}

// ───────── Пользователи ─────────
interface UserRow {
  id: string;
  firstName: string;
  telegramId: string;
  xp: number;
  streakDays: number;
  answers: number;
  exams: number;
  createdAt: string;
  lastSeenAt: string;
  online: boolean;
}
type Sort = 'recent' | 'new' | 'xp' | 'answers';
const dt = (iso: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(iso));

function Users() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-users', search, sort, page],
    queryFn: () => A<{ total: number; page: number; pageSize: number; activityTracking: boolean; users: UserRow[] }>(`/users?search=${encodeURIComponent(search)}&sort=${sort}&page=${page}`),
  });
  const d = q.data;
  const pages = d ? Math.ceil(d.total / d.pageSize) : 0;
  return (
    <div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Имя или Telegram ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      </div>
      <Chips className="mt-2" value={sort} onChange={(v) => { setSort(v); setPage(0); }} items={[
        { value: 'recent', label: 'Недавние' },
        { value: 'new', label: 'Новые' },
        { value: 'xp', label: 'По баллам' },
      ]} />
      {d ? <p className="mt-2 text-[12px] font-bold text-muted">Всего: {d.total}{d.activityTracking ? '' : ' · онлайн-статус выключен (ACTIVITY_TRACKING)'}</p> : null}
      <div className="mt-2 space-y-2">
        {d?.users.map((u) => (
          <Card key={u.id} className="p-3 flex items-center gap-3" onClick={() => setOpenId(u.id)}>
            <div className="relative shrink-0">
              <div className="size-10 rounded-full bg-pink-100 text-pink grid place-items-center font-black">{u.firstName.slice(0, 1).toUpperCase()}</div>
              {d.activityTracking && u.online ? <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-ok border-2 border-white" /> : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold truncate">{u.firstName} <span className="text-muted font-bold text-[12px]">#{u.telegramId}</span></div>
              <div className="text-[11.5px] font-bold text-muted truncate">{formatPoints(u.xp)} · ответов {u.answers} · был {dt(u.lastSeenAt)}</div>
            </div>
          </Card>
        ))}
      </div>
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Назад</Button>
          <span className="text-[13px] font-bold">{page + 1} / {pages}</span>
          <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Вперёд</Button>
        </div>
      ) : null}
      {openId ? <UserModal id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

interface UserDetail {
  user: { id: string; firstName: string; telegramId: string; xp: number; streakDays: number; bestStreak: number; answers: number; exams: number; mistakes: number; createdAt: string; lastSeenAt: string; consentAt: string | null; botCanWrite: boolean; notificationsEnabled: boolean };
  activityTracking: boolean;
  bucket: 'minute' | 'hour' | 'day';
  series: { t: string; pings: number }[];
  sessions: { start: string; end: string; minutes: number; pings: number }[];
  sessionsTotal: number;
  totalMinutes: number;
}

function UserModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [bucket, setBucket] = useState<'minute' | 'hour' | 'day'>('day');
  const q = useQuery({ queryKey: ['admin-user', id, bucket], queryFn: () => A<UserDetail>(`/users/${id}?bucket=${bucket}`) });
  const u = q.data?.user;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[560px] bg-white rounded-t-[24px] sm:rounded-[24px] p-4 pb-[calc(16px+var(--safe-bottom))] max-h-[90dvh] overflow-y-auto">
        {!u ? (
          <p className="py-8 text-center text-muted font-bold">Загрузка…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[19px] font-black">{u.firstName}</div>
                <div className="text-[12px] font-bold text-muted">Telegram ID {u.telegramId}</div>
              </div>
              <button onClick={onClose} className="size-8 grid place-items-center rounded-full bg-pink-100 text-pink font-black">✕</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Mini2 v={formatPoints(u.xp)} k="баллы" />
              <Mini2 v={u.answers} k="ответов" />
              <Mini2 v={u.exams} k="экзаменов" />
              <Mini2 v={u.streakDays} k="серия" />
              <Mini2 v={u.bestStreak} k="лучшая серия" />
              <Mini2 v={u.mistakes} k="ошибок" />
            </div>
            <div className="mt-3 text-[12.5px] font-semibold space-y-1">
              <Row k="Регистрация" v={dt(u.createdAt)} />
              <Row k="Последний вход" v={dt(u.lastSeenAt)} />
              <Row k="Согласие" v={u.consentAt ? dt(u.consentAt) : '—'} />
              <Row k="Бот может писать" v={u.botCanWrite ? 'да' : 'нет'} />
            </div>

            {q.data?.activityTracking ? (
              <>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <h3 className="font-black">Активность</h3>
                  <Chips value={bucket} onChange={setBucket} items={[
                    { value: 'minute', label: 'Минуты' },
                    { value: 'hour', label: 'Часы' },
                    { value: 'day', label: 'Дни' },
                  ]} />
                </div>
                <p className="text-[11px] font-bold text-muted mt-1">
                  {bucket === 'minute' ? 'Отметки входов за сегодня (по минутам)' : bucket === 'hour' ? 'За 2 дня (по часам)' : 'За 30 дней (по дням)'}
                </p>
                <div className="mt-2"><BarChart points={q.data.series} unit={bucket} valueKey="pings" height={100} /></div>

                <div className="mt-4 flex items-center justify-between">
                  <h3 className="font-black">Сессии</h3>
                  <span className="text-[12px] font-bold text-muted">{q.data.sessionsTotal} · всего ~{q.data.totalMinutes} мин</span>
                </div>
                <div className="mt-2 space-y-1.5 max-h-[220px] overflow-y-auto">
                  {q.data.sessions.length === 0 ? <p className="text-[13px] text-muted font-semibold">Нет отметок.</p> : null}
                  {q.data.sessions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-pink-50 border border-pink-100 px-3 py-1.5 text-[12.5px] font-bold">
                      <span>{dt(s.start)}</span>
                      <span className="text-muted">{s.minutes} мин · {s.pings} отм.</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-[12.5px] font-semibold text-muted">Трекинг посещаемости выключен (ACTIVITY_TRACKING). Доступны профиль и даты входа.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Mini2({ v, k }: { v: ReactNode; k: string }) {
  return (
    <div className="rounded-xl bg-pink-50 border border-pink-100 py-2 text-center">
      <div className="text-[16px] font-black text-pink leading-none">{v}</div>
      <div className="text-[10.5px] font-bold text-muted mt-1">{k}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{k}</span>
      <span className="font-bold text-right">{v}</span>
    </div>
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
