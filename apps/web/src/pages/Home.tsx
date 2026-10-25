import { formatPoints } from '@zayush/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, ChevronRight, Crown, Flame, GraduationCap, MessageCircleHeart, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { TopicDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { BunnyBubble, Button, Card, DemoNotice, Pill, ProgressBar, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { plural, useMe, useSay } from '../lib/hooks';

export function Home() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const say = useSay();
  const topics = useQuery({ queryKey: ['topics'], queryFn: () => api<TopicDTO[]>('/topics') });
  const seed = useMemo(() => Math.floor(Math.random() * 1000), []);
  if (!me) return null;
  const { user, stats, daily, rank, lastTicket } = me;
  const greeting = user.isNew ? say('home.greeting.new', { seed }) : say('home.greeting', { seed });
  const continueTicket = lastTicket && lastTicket.answered < lastTicket.total ? lastTicket : null;

  return (
    <Page>
      <header className="pt-[calc(var(--safe-top)+var(--content-top)+14px)] flex items-center gap-3">
        <img src="/brand/sticker-joy.webp" alt="" className="size-14 object-contain -my-1" />
        <div className="flex-1 min-w-0">
          <div className="text-[20px] font-black leading-tight">Заюш ПДД</div>
          <div className="text-[13px] font-bold text-pink truncate">Привет, {user.firstName}! 💗</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill tone="gold">
            <Crown className="size-3.5" /> {formatPoints(user.xp)}
          </Pill>
          {user.streakDays > 0 ? (
            <Pill tone="pink">
              <Flame className="size-3.5" /> {user.streakDays} {plural(user.streakDays, 'день', 'дня', 'дней')}
            </Pill>
          ) : null}
        </div>
      </header>

      <BunnyBubble className="mt-4" image="/brand/sticker-wink.webp">
        {greeting}
      </BunnyBubble>

      {/* Цель дня с машинкой */}
      <Card className="mt-4 p-4 overflow-hidden relative">
        <div className="absolute -right-6 -top-6 size-36 rounded-full bg-pink-100" />
        <div className="relative flex gap-3 items-center">
          <img src={`/brand/${user.equippedCar}.webp`} alt="" className="w-[44%] max-w-[180px] drop-shadow-md animate-float" />
          <div className="flex-1">
            <div className="text-[13px] font-extrabold text-pink">Твоя цель 💗</div>
            <div className="font-black text-[17px] leading-tight mt-0.5">
              Сегодня решить {daily.goal} {plural(daily.goal, 'вопрос', 'вопроса', 'вопросов')}
            </div>
            <ProgressBar value={daily.answered / daily.goal} className="mt-3" />
            <div className="mt-1.5 text-[12px] font-bold text-muted">
              {Math.min(daily.answered, daily.goal)} из {daily.goal} {daily.done ? '· выполнено ✨' : ''}
            </div>
          </div>
        </div>
        <Button className="mt-4 relative" onClick={() => navigate(continueTicket ? `/quiz/ticket/${continueTicket.id}` : '/quiz/daily')}>
          {say('home.cta', { seed: 0 })} <ArrowRight className="size-5" />
        </Button>
        {continueTicket ? (
          <button onClick={() => navigate(`/quiz/ticket/${continueTicket.id}`)} className="mt-3 w-full text-[13px] font-extrabold text-pink flex items-center justify-center gap-1">
            Продолжить: {continueTicket.title} · {continueTicket.answered}/{continueTicket.total} <ChevronRight className="size-4" />
          </button>
        ) : null}
      </Card>

      {/* Быстрые разделы */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Tile icon={<BookOpen className="size-6" />} title="Билеты" text="Учись в своём темпе" onClick={() => navigate('/learn')} />
        <Tile icon={<GraduationCap className="size-6" />} title="Экзамен" text="Проверь себя" onClick={() => navigate('/exam')} />
        <Tile icon={<TriangleAlert className="size-6" />} title="Знаки" text="Изучай и запоминай" onClick={() => navigate('/signs')} />
        <Tile icon={<MessageCircleHeart className="size-6" />} title="Спроси Заюша" text="Помощник" onClick={() => navigate('/assistant')} />
      </div>

      {/* Прогресс */}
      <Card className="mt-4 p-4" onClick={() => navigate('/ranks')}>
        <div className="flex items-center justify-between">
          <div className="font-black text-[17px]">Твой прогресс</div>
          <Pill>{rank.current.title}</Pill>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat value={stats.correctQuestions} label="Решено" />
          <Stat value={`${stats.accuracy}%`} label="Точность" />
          <Stat value={user.xp} label="Баллы" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={rank.ratio} className="flex-1" color="gold" />
          <span className="text-[12px] font-extrabold text-muted whitespace-nowrap">
            {rank.next ? `до «${rank.next.title}» ${formatPoints(rank.xpForNext ?? 0)}` : 'максимальный ранг 👑'}
          </span>
        </div>
        <div className="mt-2 text-[12px] font-bold text-muted">Готовность к экзамену: {stats.readiness}% вопросов решено верно</div>
      </Card>

      {/* Ежедневный челлендж */}
      <div className="mt-4 rounded-[var(--radius-card)] p-4 bg-gradient-to-br from-[#ff6fb3] to-pink text-white shadow-[var(--shadow-lift)] relative overflow-hidden">
        <div className="absolute inset-0 sparkle-bg pointer-events-none" />
        <img src="/brand/sticker-wink.webp" alt="" className="absolute -right-2 -bottom-3 h-28 object-contain opacity-95" />
        <div className="text-[12px] font-extrabold uppercase tracking-wide opacity-90">Задание дня</div>
        <div className="mt-1 font-black text-[18px] leading-tight max-w-[70%]">{say('daily.title', { seed: 0, vars: { goal: daily.goal, xp: daily.xp } })}</div>
        <div className="mt-3 max-w-[65%]">
          <div className="h-2.5 rounded-full bg-white/35 overflow-hidden">
            <div className="h-full bg-white rounded-full" style={{ width: `${Math.min(1, daily.answered / daily.goal) * 100}%` }} />
          </div>
          <div className="mt-1 text-[12px] font-bold">{daily.done ? 'Выполнено! +' + formatPoints(daily.xp) : `${daily.answered}/${daily.goal}`}</div>
        </div>
        <button onClick={() => navigate('/quiz/daily')} className="mt-3 h-10 px-5 rounded-full bg-white text-pink font-black text-[14px] active:scale-95 transition">
          Пройти сейчас →
        </button>
      </div>

      {/* Темы */}
      <div className="mt-5 flex items-center justify-between">
        <h2 className="font-black text-[17px]">Прогресс по темам</h2>
        <button className="text-[13px] font-extrabold text-pink" onClick={() => navigate('/learn?tab=topics')}>
          Все
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {topics.isPending
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)
          : (topics.data ?? []).slice(0, 4).map((t) => (
              <Card key={t.id} className="p-3.5" onClick={() => navigate(`/quiz/topic/${t.slug}`)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-extrabold text-[15px] truncate">{t.title}</div>
                  <span className="text-[12px] font-extrabold text-muted">
                    {t.correct}/{t.total}
                  </span>
                </div>
                <ProgressBar value={t.total ? t.correct / t.total : 0} className="mt-2 h-2" />
              </Card>
            ))}
      </div>

      {me.isDemoContent ? <DemoNotice className="mt-4" /> : null}
    </Page>
  );
}

function Tile({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <Card className="p-4" onClick={onClick}>
      <div className="size-11 rounded-2xl bg-pink-100 text-pink grid place-items-center">{icon}</div>
      <div className="mt-2.5 font-black text-[16px]">{title}</div>
      <div className="text-[12.5px] font-bold text-muted">{text}</div>
    </Card>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl bg-pink-50 border border-pink-100 py-2.5 text-center">
      <div className="text-[20px] font-black text-pink leading-none">{value}</div>
      <div className="text-[11.5px] font-bold text-muted mt-1">{label}</div>
    </div>
  );
}
