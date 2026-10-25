import { AGE_RATING } from '@zayush/shared';
import { Logo, ProgressBar } from '../components/ui';

/** Заставка — как экран «Заставка» в референсе */
export function Splash({ progress = 0.5 }: { progress?: number }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-8 bg-gradient-to-b from-[#ffe2f0] via-pink-50 to-[#ffd6ea]">
      <img src="/brand/bunny-car.webp" alt="" className="w-[78%] max-w-[330px] animate-float drop-shadow-[0_18px_24px_rgb(255_47_145_/_0.25)]" />
      <Logo size={56} className="-mt-5" />
      <p className="mt-5 text-center font-extrabold text-pink text-[15px]">
        Твоя дорога к правам
        <br />
        начинается здесь 💗
      </p>
      <ProgressBar value={progress} className="mt-6 w-[60%] max-w-[220px]" />
      <span className="mt-6 rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-black text-ink-soft">{AGE_RATING}</span>
    </div>
  );
}
