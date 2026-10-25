import { formatPoints } from '@zayush/shared';
import { useQuery } from '@tanstack/react-query';
import { Award, Crown, Flame, Footprints, Gem, RotateCcw, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { GarageDTO } from '@zayush/shared';
import { Page } from '../components/Layout';
import { Card, cx, Pill, ScreenHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';

const ICONS: Record<string, LucideIcon> = { Footprints, Sparkles, Gem, RotateCcw, Flame, Crown, TriangleAlert };

export function AchievementIcon({ name, unlocked }: { name: string; unlocked: boolean }) {
  const Icon = ICONS[name] ?? Award;
  return (
    <div
      className={cx(
        'mx-auto size-12 rounded-full grid place-items-center border-[3px]',
        unlocked ? 'bg-gradient-to-b from-[#ffe58a] to-gold border-white text-[#a35a00] shadow-[0_6px_14px_-6px_rgb(244_180_0_/_0.8)]' : 'bg-pink-100 border-white text-pink-300',
      )}
    >
      <Icon className="size-6" />
    </div>
  );
}

export function Achievements() {
  const g = useQuery({ queryKey: ['garage'], queryFn: () => api<GarageDTO>('/garage') });
  return (
    <Page>
      <ScreenHeader title="Достижения" back="/profile" />
      {g.isPending ? <Skeleton className="h-60" /> : null}
      <div className="space-y-2.5">
        {g.data?.achievements.map((a) => (
          <Card key={a.code} className={cx('p-3.5 flex items-center gap-3', !a.unlockedAt && 'opacity-70')}>
            <AchievementIcon name={a.icon} unlocked={!!a.unlockedAt} />
            <div className="flex-1 min-w-0">
              <div className="font-extrabold">{a.title}</div>
              <div className="text-[12.5px] font-bold text-muted">{a.description}</div>
            </div>
            {a.unlockedAt ? <Pill tone="ok">получено</Pill> : <Pill tone="gold">+{formatPoints(a.xpReward)}</Pill>}
          </Card>
        ))}
      </div>
    </Page>
  );
}
