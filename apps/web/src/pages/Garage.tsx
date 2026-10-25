import { formatPoints } from '@zayush/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Crown, Lock } from 'lucide-react';
import { useState } from 'react';
import type { GarageDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { AchievementIcon } from './Achievements';
import { celebrate } from '../components/RankUp';
import { Card, cx, ErrorState, ProgressBar, ScreenHeader, Segmented, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import { haptic } from '../lib/telegram';

export function Garage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const g = useQuery({ queryKey: ['garage'], queryFn: () => api<GarageDTO>('/garage') });
  const [tab, setTab] = useState<'car' | 'accessory' | 'sticker'>('car');
  const equip = useMutation({
    mutationFn: (code: string) => api('/garage/car', { method: 'PUT', body: { code } }),
    onSuccess: () => {
      haptic('success');
      celebrate();
      qc.invalidateQueries({ queryKey: ['garage'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (g.isPending)
    return (
      <Page>
        <ScreenHeader title="Мой гараж" back="/profile" />
        <Skeleton className="h-56" />
      </Page>
    );
  if (g.isError)
    return (
      <Page>
        <ScreenHeader title="Мой гараж" back="/profile" />
        <ErrorState message={(g.error as ApiError).message} onRetry={() => g.refetch()} />
      </Page>
    );

  const items = g.data.rewards.filter((r) => r.kind === tab);
  const level = g.data.ranks.filter((r) => r.reached).length;

  return (
    <Page>
      <ScreenHeader title="Мой гараж" back="/profile" />
      <Card className="p-4 overflow-hidden relative">
        <div className="absolute -left-10 -bottom-10 size-48 rounded-full bg-pink-100" />
        <div className="relative flex items-center gap-3">
          <img src={`/brand/${g.data.equippedCar}.webp`} alt="" className="w-[52%] drop-shadow-lg animate-float" />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 font-black text-[18px]">
              <Crown className="size-5 text-gold-deep" /> Уровень {level}
            </div>
            <div className="text-[13px] font-bold text-pink">{me?.rank.current.title}</div>
            <ProgressBar value={me?.rank.ratio ?? 0} className="mt-2" color="gold" />
            <div className="mt-1 text-[12px] font-bold text-muted">
              {me?.user.xp} / {formatPoints(me?.rank.next?.minXp ?? me?.user.xp ?? 0)}
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          items={[
            { value: 'car', label: 'Машина' },
            { value: 'accessory', label: 'Аксессуары' },
            { value: 'sticker', label: 'Стикеры' },
          ]}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {items.map((r) => {
          const equipped = tab === 'car' && g.data.equippedCar === r.code;
          return (
            <button
              key={r.code}
              disabled={!r.unlocked || tab !== 'car' || equip.isPending}
              onClick={() => equip.mutate(r.code)}
              className={cx(
                'relative rounded-[var(--radius-tile)] bg-white border-2 p-2 pt-3 flex flex-col items-center transition',
                equipped ? 'border-pink shadow-[0_0_0_4px_rgb(255_47_145_/_0.12)]' : 'border-pink-100',
                r.unlocked && tab === 'car' && !equipped && 'active:scale-95',
              )}
            >
              <img src={r.image} alt="" loading="lazy" className={cx('h-16 w-full object-contain', !r.unlocked && 'grayscale opacity-40')} />
              <div className="mt-1.5 text-[11.5px] font-extrabold leading-tight text-center">{r.title}</div>
              {!r.unlocked ? (
                <div className="mt-1 flex items-center gap-1 text-[10.5px] font-bold text-muted leading-tight text-center">
                  <Lock className="size-3 shrink-0" /> {r.unlockRank ?? 'скоро'}
                </div>
              ) : equipped ? (
                <div className="absolute top-1.5 right-1.5 size-5 rounded-full bg-pink text-white grid place-items-center">
                  <Check className="size-3" strokeWidth={3} />
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      {tab === 'car' ? <p className="mt-2 text-[12px] font-bold text-muted text-center">Нажми на открытую машинку, чтобы пересесть в неё 💅</p> : null}

      <div className="mt-5 flex items-center justify-between">
        <h2 className="font-black text-[17px]">Достижения</h2>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2.5">
        {g.data.achievements.slice(0, 6).map((a) => (
          <div key={a.code} className={cx('rounded-[var(--radius-tile)] bg-white border border-pink-100 p-2.5 text-center', !a.unlockedAt && 'opacity-50')}>
            <AchievementIcon name={a.icon} unlocked={!!a.unlockedAt} />
            <div className="mt-1.5 text-[11.5px] font-extrabold leading-tight">{a.title}</div>
            <div className="text-[10.5px] font-bold text-muted">+{formatPoints(a.xpReward)}</div>
          </div>
        ))}
      </div>
    </Page>
  );
}
