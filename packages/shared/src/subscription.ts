/**
 * Конфигурация обязательной подписки.
 *
 * Формат переменных окружения (источники разделяются «;», поля — «|»):
 *   REQUIRE_SUBSCRIPTION=true
 *   REQUIRED_CHANNELS=@zayush_channel|https://t.me/zayush_channel|Канал Заюша
 *   REQUIRED_GROUPS=-1001234567890|https://t.me/+AbCdEf|Чат Заюша
 *
 * chatId — @username публичного чата или числовой id (-100…) закрытого.
 * Ссылку для закрытых чатов указывает владелец; приложение её не угадывает.
 */
export type SourceKind = 'CHANNEL' | 'GROUP';

export interface SubscriptionSource {
  kind: SourceKind;
  chatId: string;
  inviteUrl: string;
  title: string;
}

export interface SubscriptionConfig {
  enabled: boolean;
  sources: SubscriptionSource[];
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function parseBool(v: string | undefined | null, fallback = false): boolean {
  if (v == null || v.trim() === '') return fallback;
  return TRUE_VALUES.has(v.trim().toLowerCase());
}

export function isValidChatId(chatId: string): boolean {
  return /^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(chatId) || /^-?\d{5,20}$/.test(chatId);
}

export function isValidInviteUrl(url: string): boolean {
  return /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+\-/]+$/.test(url);
}

export function parseSourceList(raw: string | undefined, kind: SourceKind): { sources: SubscriptionSource[]; errors: string[] } {
  const sources: SubscriptionSource[] = [];
  const errors: string[] = [];
  if (!raw) return { sources, errors };
  for (const chunk of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [chatIdRaw, inviteRaw, titleRaw] = chunk.split('|').map((s) => s?.trim());
    const chatId = chatIdRaw ?? '';
    let inviteUrl = inviteRaw ?? '';
    if (!isValidChatId(chatId)) {
      errors.push(`Неверный идентификатор чата: «${chatId}»`);
      continue;
    }
    if (!inviteUrl && chatId.startsWith('@')) inviteUrl = `https://t.me/${chatId.slice(1)}`;
    if (!isValidInviteUrl(inviteUrl)) {
      errors.push(`Для ${chatId} нужна ссылка вида https://t.me/... (для закрытых чатов — ссылка-приглашение)`);
      continue;
    }
    sources.push({
      kind,
      chatId,
      inviteUrl,
      title: titleRaw || (kind === 'CHANNEL' ? 'Наш канал' : 'Наш чат'),
    });
  }
  return { sources, errors };
}

export function parseSubscriptionEnv(env: Record<string, string | undefined>): SubscriptionConfig & { errors: string[] } {
  const ch = parseSourceList(env.REQUIRED_CHANNELS, 'CHANNEL');
  const gr = parseSourceList(env.REQUIRED_GROUPS, 'GROUP');
  const sources = [...ch.sources, ...gr.sources];
  return {
    enabled: parseBool(env.REQUIRE_SUBSCRIPTION) && sources.length > 0,
    sources,
    errors: [...ch.errors, ...gr.errors],
  };
}

/**
 * Считается ли статус участника из getChatMember подпиской.
 * restricted — участник с ограничениями: подписан, если is_member = true.
 */
export function isMemberStatus(status: string, isMember?: boolean): boolean {
  if (status === 'creator' || status === 'administrator' || status === 'member') return true;
  if (status === 'restricted') return isMember === true;
  return false;
}
