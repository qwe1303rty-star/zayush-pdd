import confetti from 'canvas-confetti';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { type RankDTO, rewardByCode } from '@zayush/shared';
import { haptic } from '../lib/telegram';
import { Button, Modal } from './ui';

interface RankUpCtx {
  showRankUp: (rank: RankDTO) => void;
  celebrate: () => void;
}
const Ctx = createContext<RankUpCtx>({ showRankUp: () => {}, celebrate: () => {} });
export const useRankUp = () => useContext(Ctx);

export function celebrate() {
  const colors = ['#FF2F91', '#FFD34E', '#FFFFFF', '#FFB3D6'];
  confetti({ particleCount: 90, spread: 75, origin: { y: 0.55 }, colors, disableForReducedMotion: true });
}

export function RankUpProvider({ children }: { children: ReactNode }) {
  const [rank, setRank] = useState<RankDTO | null>(null);
  const showRankUp = useCallback((r: RankDTO) => {
    setRank(r);
    haptic('success');
    setTimeout(celebrate, 150);
  }, []);
  return (
    <Ctx.Provider value={{ showRankUp, celebrate }}>
      {children}
      <Modal open={!!rank} onClose={() => setRank(null)}>
        {rank ? (
          <div className="text-center">
            <div className="text-[13px] font-extrabold text-pink uppercase tracking-wider">Новый ранг!</div>
            <img src={rank.image} alt="" className="mx-auto mt-3 h-56 w-auto object-contain drop-shadow-[0_14px_24px_rgb(255_47_145_/_0.35)] animate-pop" />
            <div className="mt-3 text-[22px] font-black text-pink">{rank.title}</div>
            <p className="mt-3 font-bold text-ink-soft">{rank.tagline}</p>
            {rank.rewards.length ? (
              <div className="mt-4 rounded-2xl bg-pink-50 p-3">
                <div className="text-[13px] font-extrabold text-muted mb-2">Открыто в гараже</div>
                <div className="flex justify-center gap-3 flex-wrap">
                  {rank.rewards.map((code) => {
                    const r = rewardByCode(code);
                    return r ? (
                      <div key={code} className="w-20 text-center">
                        <img src={r.image} alt="" className="h-14 mx-auto object-contain" />
                        <div className="text-[11px] font-bold mt-1 leading-tight">{r.title}</div>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-[12px] text-muted font-semibold">Ранг — игровая награда за учёбу 💗</p>
            <Button className="mt-4" onClick={() => setRank(null)}>
              Забрать награду
            </Button>
          </div>
        ) : null}
      </Modal>
    </Ctx.Provider>
  );
}
