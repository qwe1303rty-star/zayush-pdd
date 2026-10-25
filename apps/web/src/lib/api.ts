import { initDataRaw } from './telegram';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const ADMIN_TOKEN_KEY = 'zayush:admin-token';

// Базовый адрес API. Пусто — относительный путь (один домен, production/Docker).
// Для GitHub Pages задайте VITE_API_BASE=https://your-backend.example в сборке.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setAdminToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* noop */
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; admin?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const initData = initDataRaw();
  if (initData) headers.Authorization = `tma ${initData}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.admin) {
    const t = getAdminToken();
    if (t) headers['X-Admin-Token'] = t;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Кажется, пропал интернет. Как появится — продолжим 💗');
  }
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    let message = 'Ой, что-то пошло не так. Давай попробуем ещё раз?';
    try {
      const j = await res.json();
      if (j?.error) {
        code = j.error.code ?? code;
        message = j.error.message ?? message;
      }
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // запасной вариант для старых WebView
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
