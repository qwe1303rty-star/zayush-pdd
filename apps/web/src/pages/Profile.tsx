import { formatPoints } from '@zayush/shared';
import { useQuery } from '@tanstack/react-query';
import { Award, Car, ChevronDown, ChevronRight, Crown, Flame, GraduationCap, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { TopicDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { Card, Pill, ProgressBar, ScreenHeader } from '../components/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';

export function Profile() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const topics = useQuery({ queryKey: ['topics'], queryFn: () => api<TopicDTO[]>('/topics') });
  const [readinessOpen, setReadinessOpen] = useState(false);
  if (!me) return null;
  const { user, rank, stats } = me;

  return (
    <Page>
      <ScreenHeader title="Профиль" back={null} />
      <Card className="p-5 text-center relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-pink-100 to-transparent" />
        <img src={rank.current.image} alt={rank.current.title} className="relative h-44 w-auto mx-auto object-contain drop-shadow-[0_12px_20px_rgb(255_47_145_/_0.3)]" />
        <div className="relative mt-2 text-[22px] font-black">{user.firstName} 💗</div>
        <div className="relative mt-1 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#ff5aa8] to-pink text-white px-3.5 py-1 font-black text-[14px]">
          <Crown className="size-4" /> {rank.current.title}
        </div>
        <div className="relative mt-4">
          <ProgressBar value={rank.ratio} color="gold" />
          <div className="mt-1.5 text-[12.5px] font-bold text-muted">
            {formatPoints(user.xp)} {rank.next ? `· до «${rank.next.title}» ещё ${formatPoints(rank.xpForNext ?? 0)}` : '· максимальный ранг'}
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <Mini value={stats.correctQuestions} label="решено верно" />
          <Mini value={`${stats.accuracy}%`} label="точность" />
          <Mini value={user.bestStreak} label="лучшая серия" icon={<Flame className="size-3.5" />} />
        </div>
      </Card>

      <Card className="mt-3 p-4">
        <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setReadinessOpen((v) => !v)}>
          <div className="flex items-center gap-2 font-black">
            Готовность к экзамену
            <ChevronDown className={`size-4 text-muted transition-transform ${readinessOpen ? 'rotate-180' : ''}`} />
          </div>
          <Pill tone={stats.readiness >= 85 ? 'ok' : 'pink'}>{stats.readiness}%</Pill>
        </div>
        <ProgressBar value={stats.readiness / 100} className="mt-2" color="ok" />
        <div className="mt-1.5 text-[12px] font-bold text-muted">
          {stats.examsPassed} из {stats.examsTotal} экзаменов сдано · {stats.openMistakes} ошибок ждут повторения
        </div>
        {readinessOpen ? (
          <div className="mt-3 space-y-2">
            {topics.data?.map((t) => (
              <div key={t.id}>
                <div className="flex justify-between text-[13px] font-bold">
                  <span>{t.title}</span>
                  <span className="text-muted">
                    {t.correct}/{t.total}
                  </span>
                </div>
                <ProgressBar value={t.total ? t.correct / t.total : 0} className="h-1.5 mt-1" />
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <div className="mt-3 space-y-2">
        <MenuItem icon={<Car className="size-5" />} title="Мой гараж" text="Машинки, аксессуары, стикеры" onClick={() => navigate('/garage')} />
        <MenuItem icon={<Crown className="size-5" />} title="Ранги" text="Путь к Императрице ПДД" onClick={() => navigate('/ranks')} />
        <MenuItem icon={<Award className="size-5" />} title="Достижения" text="Твои награды" onClick={() => navigate('/achievements')} />
        <MenuItem icon={<GraduationCap className="size-5" />} title="История экзаменов" text="Все попытки и разборы" onClick={() => navigate('/exam')} />
        <MenuItem icon={<SettingsIcon className="size-5" />} title="Настройки" text="Уведомления, прогресс, о приложении" onClick={() => navigate('/settings')} />
        {user.isAdmin ? <MenuItem icon={<ShieldCheck className="size-5" />} title="Админ-панель" text="Контент, подписки, статистика" onClick={() => navigate('/admin')} /> : null}
      </div>
      <p className="mt-4 text-center text-[11.5px] font-semibold text-muted">Ранги — игровая метафора прогресса в учёбе и никак не оценивают тебя саму 💗</p>
    </Page>
  );
}

function Mini({ value, label, icon }: { value: ReactNode; label: string; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-pink-50 border border-pink-100 py-2.5">
      <div className="text-[20px] font-black text-pink leading-none flex items-center justify-center gap-1">
        {icon}
        {value}
      </div>
      <div className="text-[11px] font-bold text-muted mt-1">{label}</div>
    </div>
  );
}

export function MenuItem({ icon, title, text, onClick, right }: { icon: ReactNode; title: string; text?: string; onClick?: () => void; right?: ReactNode }) {
  return (
    <Card className="p-3.5 flex items-center gap-3" onClick={onClick}>
      <div className="size-10 rounded-xl bg-pink-100 text-pink grid place-items-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-extrabold">{title}</div>
        {text ? <div className="text-[12.5px] font-bold text-muted truncate">{text}</div> : null}
      </div>
      {right ?? (onClick ? <ChevronRight className="size-5 text-muted" /> : null)}
    </Card>
  );
}
