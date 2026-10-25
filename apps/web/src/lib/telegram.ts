/**
 * Интеграция с официальным SDK Telegram Mini Apps (telegram-web-app.js).
 * Вне Telegram (обычный браузер при разработке) все вызовы безопасно игнорируются.
 */
import type { WebApp } from 'telegram-web-app';

export const tg: WebApp | undefined = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

export const isTelegram = !!tg && !!tg.initData;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor('#FFF0F7');
      tg.setBackgroundColor('#FFF0F7');
    }
    if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor('#FFFFFF');
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
  } catch {
    /* старые клиенты Telegram */
  }
}

export function initDataRaw(): string {
  return tg?.initData ?? '';
}

export function haptic(kind: 'success' | 'error' | 'warning' | 'light' | 'medium' | 'select') {
  const h = tg?.HapticFeedback;
  if (!h || !tg?.isVersionAtLeast('6.1')) return;
  try {
    if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
    else if (kind === 'select') h.selectionChanged();
    else h.impactOccurred(kind);
  } catch {
    /* noop */
  }
}

export function openTelegramLink(url: string) {
  if (tg && tg.isVersionAtLeast('6.1') && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg && tg.isVersionAtLeast('6.2')) tg.showConfirm(message, (ok: boolean) => resolve(ok));
    else resolve(window.confirm(message));
  });
}

export function enableClosingConfirmation(on: boolean) {
  if (!tg || !tg.isVersionAtLeast('6.2')) return;
  if (on) tg.enableClosingConfirmation();
  else tg.disableClosingConfirmation();
}
