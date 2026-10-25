import { ChevronLeft, RefreshCw } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTelegramBack } from '../lib/hooks';
import { isTelegram } from '../lib/telegram';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'dark';
export function Button({
  variant = 'primary',
  size = 'lg',
  className,
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'lg' | 'md' | 'sm'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-extrabold transition active:scale-[0.97] disabled:opacity-55 select-none',
        size === 'lg' && 'h-[52px] px-6 text-[16px] w-full',
        size === 'md' && 'h-11 px-5 text-[15px]',
        size === 'sm' && 'h-8 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-gradient-to-b from-[#ff4fa3] to-pink text-white shadow-[var(--shadow-button)]',
        variant === 'secondary' && 'bg-white text-pink border-2 border-pink-300',
        variant === 'ghost' && 'bg-pink-100 text-pink',
        variant === 'dark' && 'bg-ink text-white',
        className,
      )}
    >
      {loading ? <RefreshCw className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cx(
        'block w-full text-left bg-white rounded-[var(--radius-card)] shadow-[var(--shadow-card)] border border-pink-100',
        onClick && 'transition active:scale-[0.985]',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function ProgressBar({ value, className, color = 'pink' }: { value: number; className?: string; color?: 'pink' | 'gold' | 'ok' }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cx('h-2.5 rounded-full bg-pink-100 overflow-hidden', className)} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500',
          color === 'pink' && 'bg-gradient-to-r from-[#ff7ab8] to-pink',
          color === 'gold' && 'bg-gradient-to-r from-gold to-gold-deep',
          color === 'ok' && 'bg-ok',
        )}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  );
}

/** Шапка внутреннего экрана со стрелкой назад (как в референсах) */
export function ScreenHeader({ title, back = -1, right, subtitle }: { title: ReactNode; back?: string | number | null; right?: ReactNode; subtitle?: ReactNode }) {
  const navigate = useNavigate();
  useTelegramBack(back);
  return (
    <header className="sticky top-0 z-20 -mx-4 px-4 pt-[calc(var(--safe-top)+var(--content-top)+10px)] pb-2 bg-pink-50/85 backdrop-blur-md">
      <div className="flex items-center gap-2 min-h-10">
        {back !== null && !isTelegram ? (
          <button
            aria-label="Назад"
            onClick={() => (typeof back === 'number' ? navigate(back) : navigate(back))}
            className="-ml-1.5 size-10 grid place-items-center rounded-full active:bg-pink-100"
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          <h1 className="text-[21px] font-black leading-tight truncate">{title}</h1>
          {subtitle ? <div className="text-[13px] text-muted font-semibold">{subtitle}</div> : null}
        </div>
        {right}
      </div>
    </header>
  );
}

export function Pill({ children, className, tone = 'pink' }: { children: ReactNode; className?: string; tone?: 'pink' | 'gold' | 'ok' | 'bad' | 'sky' | 'ink' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-extrabold whitespace-nowrap',
        tone === 'pink' && 'bg-pink-100 text-pink',
        tone === 'gold' && 'bg-[#fff4cf] text-[#a87400]',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'sky' && 'bg-sky-soft text-sky',
        tone === 'ink' && 'bg-ink text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chips<T extends string>({ items, value, onChange, className }: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 py-1', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'shrink-0 h-9 px-4 rounded-full text-[14px] font-extrabold transition',
            value === it.value ? 'bg-pink text-white shadow-[var(--shadow-button)]' : 'bg-white text-ink-soft border border-pink-200',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ items, value, onChange }: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex p-1 bg-white rounded-full border border-pink-200">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cx('flex-1 h-9 rounded-full text-[14px] font-extrabold transition', value === it.value ? 'bg-pink text-white' : 'text-ink-soft')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function NumberBadge({ n, tone = 'pink', size = 44 }: { n: ReactNode; tone?: 'pink' | 'ok' | 'muted'; size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className={cx(
        'shrink-0 grid place-items-center rounded-full text-[18px] font-black',
        tone === 'pink' && 'bg-gradient-to-b from-[#ff5aa8] to-pink text-white shadow-[var(--shadow-button)]',
        tone === 'ok' && 'bg-ok text-white',
        tone === 'muted' && 'bg-pink-100 text-pink',
      )}
    >
      {n}
    </div>
  );
}

/** Реплика зайчика — фирменный приём из референсов */
export function BunnyBubble({ children, image = '/brand/sticker-joy.webp', className, tone = 'white' }: { children: ReactNode; image?: string; className?: string; tone?: 'white' | 'ok' | 'bad' }) {
  return (
    <div className={cx('flex items-end gap-2.5 animate-fade-up', className)}>
      <img src={image} alt="" className="size-14 shrink-0 object-contain drop-shadow-sm" />
      <div
        className={cx(
          'relative flex-1 rounded-[20px] rounded-bl-md px-4 py-3 text-[14.5px] font-bold leading-snug border',
          tone === 'white' && 'bg-white border-pink-100 shadow-[var(--shadow-card)]',
          tone === 'ok' && 'bg-ok-soft border-[#bfeccf] text-[#176b3e]',
          tone === 'bad' && 'bg-bad-soft border-[#ffc6d1] text-[#a3203a]',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-2xl', className)} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="py-10 flex flex-col items-center text-center gap-4">
      <img src="/brand/sticker-wow.webp" alt="" className="size-28 object-contain" />
      <p className="font-bold text-ink-soft max-w-[280px]">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="md" onClick={onRetry}>
          <RefreshCw className="size-4" /> Попробовать ещё раз
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, text, image = '/brand/sticker-tender.webp', action }: { title: string; text?: string; image?: string; action?: ReactNode }) {
  return (
    <div className="py-10 flex flex-col items-center text-center gap-3">
      <img src={image} alt="" className="size-28 object-contain animate-float" />
      <h3 className="text-lg font-black">{title}</h3>
      {text ? <p className="text-ink-soft font-semibold max-w-[300px]">{text}</p> : null}
      {action}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative w-12 h-7 rounded-full transition', checked ? 'bg-pink' : 'bg-pink-200', disabled && 'opacity-50')}
    >
      <span className={cx('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-t-[28px] sm:rounded-[28px] p-5 pb-[calc(20px+var(--safe-bottom))] animate-pop max-h-[90dvh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

/**
 * Надпись «Заюш ПДД» — как в бренд-паке: розовое «Заюш» с белой и чёрной обводкой, чёрное «ПДД».
 * Сделана шрифтом (а не картинкой), поэтому чёткая на любом экране. size — высота строки «Заюш» в px.
 */
export function Logo({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <div role="img" aria-label="Заюш ПДД" className={cx('wordmark inline-flex flex-col items-center -rotate-6 select-none', className)} style={{ fontSize: size }}>
      <span className="wordmark-pink">Заюш</span>
      <span className="wordmark-ink" style={{ marginTop: -size * 0.28 }}>ПДД</span>
    </div>
  );
}

export function DemoNotice({ className }: { className?: string }) {
  return (
    <div className={cx('rounded-2xl bg-[#fff6d6] border border-[#ffe69a] px-3.5 py-2.5 text-[12.5px] font-bold text-[#7a5a00]', className)}>
      🧪 Демонстрационные вопросы: составлены по тексту ПДД РФ, но это не официальные билеты ГИБДД.
    </div>
  );
}
