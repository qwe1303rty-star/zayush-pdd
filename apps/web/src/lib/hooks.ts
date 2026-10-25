import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { say as sayRaw, type MeDTO, type VoiceKey, VOICE } from '@zayush/shared';
import { api } from './api';
import { tg } from './telegram';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeDTO>('/me'), staleTime: 15_000 });
}

/** Тексты голоса: локальные значения + переопределения из админки */
export function useTexts() {
  return useQuery({
    queryKey: ['texts'],
    queryFn: () => api<Record<string, string[]>>('/texts'),
    staleTime: 5 * 60_000,
    placeholderData: VOICE as unknown as Record<string, string[]>,
  });
}

export function useSay() {
  const { data } = useTexts();
  return useMemo(
    () =>
      (key: VoiceKey, opts: { seed?: number; vars?: Record<string, string | number> } = {}) =>
        sayRaw(key, { ...opts, overrides: data as never }),
    [data],
  );
}

/** Кнопка «Назад» Telegram: показываем на внутренних экранах */
export function useTelegramBack(to: string | number | null = -1) {
  const navigate = useNavigate();
  const target = useRef(to);
  target.current = to;
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb || !tg?.isVersionAtLeast('6.1') || to === null) return;
    const handler = () => {
      const t = target.current;
      if (typeof t === 'number') navigate(t);
      else if (t) navigate(t);
    };
    bb.show();
    bb.onClick(handler);
    return () => {
      bb.offClick(handler);
      bb.hide();
    };
  }, [navigate, to === null]);
}

export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
