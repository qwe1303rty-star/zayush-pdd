import { BookOpen, House, MessageCircleHeart, TriangleAlert, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { haptic } from '../lib/telegram';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Главная', icon: House, match: (p: string) => p === '/' },
  { to: '/learn', label: 'Учиться', icon: BookOpen, match: (p: string) => p.startsWith('/learn') || p.startsWith('/quiz') || p.startsWith('/exam') },
  { to: '/signs', label: 'Знаки', icon: TriangleAlert, match: (p: string) => p.startsWith('/signs') },
  { to: '/assistant', label: 'Помощь', icon: MessageCircleHeart, match: (p: string) => p.startsWith('/assistant') },
  {
    to: '/profile',
    label: 'Профиль',
    icon: UserRound,
    match: (p: string) => ['/profile', '/garage', '/settings', '/ranks', '/achievements'].some((x) => p.startsWith(x)),
  },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-pink-100 shadow-[0_-6px_20px_-12px_rgb(255_47_145_/_0.35)]"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mx-auto max-w-[520px] h-[var(--nav-h)] grid grid-cols-5">
        {NAV.map((n) => {
          const active = n.match(pathname);
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={() => haptic('select')}
              className="flex flex-col items-center justify-center gap-0.5"
              aria-current={active ? 'page' : undefined}
            >
              <span className={cx('grid place-items-center h-8 w-12 rounded-full transition', active && 'bg-pink-100')}>
                <Icon className={cx('size-[22px]', active ? 'text-pink' : 'text-[#8d8494]')} strokeWidth={active ? 2.5 : 2} />
              </span>
              <span className={cx('text-[11px] font-extrabold', active ? 'text-pink' : 'text-[#8d8494]')}>{n.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export function Page({ children, nav = true, className }: { children: ReactNode; nav?: boolean; className?: string }) {
  return (
    <>
      <main
        className={cx('mx-auto max-w-[520px] px-4', className)}
        style={{ paddingBottom: nav ? 'calc(var(--nav-h) + var(--safe-bottom) + 20px)' : 'calc(var(--safe-bottom) + 20px)' }}
      >
        {children}
      </main>
      {nav ? <BottomNav /> : null}
    </>
  );
}
