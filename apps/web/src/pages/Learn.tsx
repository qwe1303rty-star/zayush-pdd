import { useQuery } from '@tanstack/react-query';
import { ChevronRight, GraduationCap, Heart, RotateCcw } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import type { MeDTO, TicketDTO, TopicDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { BunnyBubble, Button, Card, Chips, DemoNotice, EmptyState, ErrorState, NumberBadge, ProgressBar, ScreenHeader, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { plural, useMe, useSay } from '../lib/hooks';

type Tab = 'tickets' | 'topics' | 'favorites' | 'mistakes';

export function Learn() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'tickets';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const navigate = useNavigate();
  const { data: me } = useMe();
  const say = useSay();

  return (
    <Page>
      <ScreenHeader title="Билеты ПДД" back={null} />
      <Card className="p-4 flex items-center gap-3 bg-gradient-to-r from-white to-pink-50" onClick={() => navigate('/exam')}>
        <div className="size-12 rounded-2xl bg-ink text-white grid place-items-center">
          <GraduationCap className="size-6" />
        </div>
        <div className="flex-1">
          <div className="font-black">Экзамен как в ГИБДД</div>
          <div className="text-[12.5px] font-bold text-muted">20 вопросов · 20 минут · без подсказок</div>
        </div>
        <ChevronRight className="size-5 text-pink" />
      </Card>

      <Chips
        className="mt-3"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'tickets', label: 'Билеты' },
          { value: 'topics', label: 'По темам' },
          { value: 'favorites', label: 'Избранное' },
          { value: 'mistakes', label: `Ошибки${me?.stats.openMistakes ? ` · ${me.stats.openMistakes}` : ''}` },
        ]}
      />

      <BunnyBubble className="mt-3">{say('tickets.title.hint', { seed: tab.length })}</BunnyBubble>

      <div className="mt-3">
        {tab === 'tickets' && <Tickets />}
        {tab === 'topics' && <Topics />}
        {tab === 'favorites' && <SetLauncher kind="favorites" me={me} />}
        {tab === 'mistakes' && <SetLauncher kind="mistakes" me={me} />}
      </div>
      {me?.isDemoContent ? <DemoNotice className="mt-4" /> : null}
    </Page>
  );
}

function Tickets() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api<TicketDTO[]>('/tickets') });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={(q.error as ApiError).message} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title="Билетов пока нет" text="Владелец ещё не загрузил вопросы." />;
  return (
    <div className="space-y-3">
      {q.data.map((t) => {
        const started = t.answered > 0;
        const done = t.answered === t.total;
        const pct = t.total ? Math.round((t.correct / t.total) * 100) : 0;
        return (
          <Card key={t.id} className="p-4" onClick={() => navigate(`/quiz/ticket/${t.id}`)}>
            <div className="flex items-center gap-3">
              <NumberBadge n={t.number} tone={done && t.correct === t.total ? 'ok' : 'pink'} />
              <div className="flex-1 min-w-0">
                <div className="font-black text-[16px]">{t.title}</div>
                <div className="text-[12.5px] font-bold text-muted">
                  {t.total} {plural(t.total, 'вопрос', 'вопроса', 'вопросов')} · <span className={pct ? 'text-pink' : ''}>{pct}%</span>
                </div>
              </div>
              <ChevronRight className="size-5 text-muted" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar value={t.total ? t.answered / t.total : 0} className="flex-1 h-2" />
              <span className="h-8 px-3.5 rounded-full text-[13px] font-extrabold grid place-items-center bg-pink-100 text-pink">
                {done ? 'Повторить' : started ? 'Продолжить' : 'Начать'}
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Topics() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['topics'], queryFn: () => api<TopicDTO[]>('/topics') });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={(q.error as ApiError).message} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      {q.data.map((t) => (
        <Card key={t.id} className="p-4" onClick={() => navigate(`/quiz/topic/${t.slug}`)}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-black text-[16px]">{t.title}</div>
              <div className="text-[12.5px] font-bold text-muted">{t.description}</div>
            </div>
            <span className="text-[13px] font-extrabold text-pink whitespace-nowrap">
              {t.correct}/{t.total}
            </span>
          </div>
          <ProgressBar value={t.total ? t.correct / t.total : 0} className="mt-3 h-2" />
        </Card>
      ))}
    </div>
  );
}

function SetLauncher({ kind, me }: { kind: 'favorites' | 'mistakes'; me?: MeDTO }) {
  const navigate = useNavigate();
  const say = useSay();
  const count = kind === 'favorites' ? me?.stats.favorites ?? 0 : me?.stats.openMistakes ?? 0;
  if (!count)
    return kind === 'favorites' ? (
      <EmptyState title="Избранное пустое" text={say('favorites.empty', { seed: 0 })} image="/brand/sticker-smile.webp" />
    ) : (
      <EmptyState title="Ошибок нет" text={say('mistakes.empty', { seed: 1 })} image="/brand/sticker-wink.webp" />
    );
  return (
    <Card className="p-5 text-center">
      <img src={kind === 'favorites' ? '/brand/sticker-tender.webp' : '/brand/sticker-hello.webp'} alt="" className="h-28 mx-auto object-contain" />
      <div className="mt-2 text-[18px] font-black">
        {kind === 'favorites' ? 'Избранные вопросы' : 'Работа над ошибками'}
      </div>
      <p className="mt-1 font-bold text-muted">
        {count} {plural(count, 'вопрос', 'вопроса', 'вопросов')}
        {kind === 'mistakes' ? ' ждут реванша. За исправление — бонусные баллы!' : ''}
      </p>
      <Button className="mt-4" onClick={() => navigate(`/quiz/${kind}`)}>
        {kind === 'favorites' ? <Heart className="size-5" /> : <RotateCcw className="size-5" />}
        {kind === 'favorites' ? 'Повторить избранное' : 'Повторить ошибки'}
      </Button>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[92px]" />
      ))}
    </div>
  );
}
