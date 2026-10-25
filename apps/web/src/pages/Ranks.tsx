import { formatPoints } from '@zayush/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Lock } from 'lucide-react';
import { type GarageDTO, rewardByCode } from '@zayush/shared';
import { Page } from '../components/Layout';
import { Card, cx, Logo, Pill, ProgressBar, ScreenHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';

/** Ранги за XP — как на листе «Кроличий путь к звёздам»: картинка ранга уже содержит его название */
export function Ranks() {
  const { data: me } = useMe();
  const g = useQuery({ queryKey: ['garage'], queryFn: () => api<GarageDTO>('/garage') });
  return (
    <Page>
      <ScreenHeader title="Ранги за баллы" back="/profile" />
      <div className="flex items-center gap-3">
        <Logo size={28} className="ml-2" />
        <p className="flex-1 font-extrabold text-pink text-[14px] leading-snug">Учись, набирай баллы и открывай новые звания! 💗</p>
      </div>

      {me ? (
        <Card className="mt-3 p-3.5">
          <div className="flex items-center justify-between text-[13px] font-extrabold">
            <span>
              Сейчас: <span className="text-pink">{me.rank.current.title}</span>
            </span>
            <span className="text-muted">{formatPoints(me.user.xp)}</span>
          </div>
          <ProgressBar value={me.rank.ratio} color="gold" className="mt-2" />
          <div className="mt-1.5 text-[12px] font-bold text-muted">
            {me.rank.next ? `До «${me.rank.next.title}» ещё ${formatPoints(me.rank.xpForNext ?? 0)}` : 'Максимальный ранг — ты звезда! 👑'}
          </div>
        </Card>
      ) : null}

      {g.isPending ? <Skeleton className="h-72 mt-3" /> : null}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {g.data?.ranks.map((r) => {
          const current = me?.rank.current.code === r.code;
          return (
            <Card key={r.code} className={cx('relative p-2.5 pt-3 flex flex-col items-center text-center', current && 'border-2 border-pink shadow-[var(--shadow-lift)]')}>
              {current ? <Pill className="absolute top-2 left-2 z-10">ты здесь</Pill> : null}
              <div className="absolute top-2 right-2 z-10">
                {r.reached ? <CheckCircle2 className="size-5 text-ok" /> : <Lock className="size-4 text-muted" />}
              </div>
              <img src={r.image} alt={r.title} loading="lazy" className={cx('h-[150px] w-auto object-contain', !r.reached && 'grayscale-[70%] opacity-70')} />
              <Pill tone="gold" className="mt-1.5">
                {formatPoints(r.minXp)}
              </Pill>
              <div className="mt-1.5 text-[11.5px] font-bold text-muted leading-snug min-h-[30px]">{r.tagline}</div>
              <div className="mt-1.5 flex justify-center gap-1">
                {r.rewards.map((code) => {
                  const rw = rewardByCode(code);
                  return rw ? <img key={code} src={rw.image} alt={rw.title} title={rw.title} className="h-7 w-auto max-w-9 object-contain" /> : null;
                })}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-center text-[11.5px] font-semibold text-muted">Ранги — игровая метафора прогресса в учёбе. Готовность к экзамену смотри в профиле 💗</p>
    </Page>
  );
}
