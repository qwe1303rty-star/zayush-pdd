import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка Telegram Mini App initData на сервере.
 * Алгоритм — из документации Telegram (Validating data received via the Mini App):
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 * data_check_string — все поля, кроме hash, отсортированные по ключу, в формате key=value через \n.
 */
export interface TelegramInitUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface VerifiedInitData {
  user: TelegramInitUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
}

export type InitDataError = 'missing' | 'malformed' | 'bad-hash' | 'expired' | 'no-user';

export class InitDataValidationError extends Error {
  constructor(public reason: InitDataError) {
    super(`initData invalid: ${reason}`);
  }
}

export function computeInitDataHash(params: URLSearchParams, botToken: string): string {
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) if (k !== 'hash') pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
}

export function verifyInitData(
  raw: string | undefined | null,
  botToken: string,
  maxAgeSec: number,
  now: Date = new Date(),
): VerifiedInitData {
  if (!raw || !botToken) throw new InitDataValidationError('missing');
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    throw new InitDataValidationError('malformed');
  }
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataValidationError('malformed');

  const expected = computeInitDataHash(params, botToken);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new InitDataValidationError('bad-hash');

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataValidationError('malformed');
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAgeSec) throw new InitDataValidationError('expired');

  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataValidationError('no-user');
  let user: TelegramInitUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new InitDataValidationError('malformed');
  }
  if (typeof user?.id !== 'number' || typeof user.first_name !== 'string') throw new InitDataValidationError('no-user');

  return {
    user,
    authDate: new Date(authDateSec * 1000),
    queryId: params.get('query_id') ?? undefined,
    startParam: params.get('start_param') ?? undefined,
  };
}

/** Утилита для тестов и локальной разработки: формирует корректно подписанную initData */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.set('hash', computeInitDataHash(params, botToken));
  return params.toString();
}
