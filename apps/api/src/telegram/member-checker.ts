import { Api, GrammyError, HttpError } from 'grammy';

export type MemberCheckResult =
  | { kind: 'ok'; status: string; isMember?: boolean }
  /** Пользователь не найден в чате (не подписан) */
  | { kind: 'not-member' }
  /** Ошибка конфигурации: бот не в чате, нет прав, чат не найден */
  | { kind: 'config-error'; description: string }
  /** Временная ошибка сети / Telegram API */
  | { kind: 'unavailable'; description: string };

export interface ChatMemberChecker {
  check(chatId: string, userId: number): Promise<MemberCheckResult>;
}

/** Проверка членства через Bot API getChatMember (grammY) */
export class TelegramMemberChecker implements ChatMemberChecker {
  private api: Api;
  constructor(botToken: string) {
    this.api = new Api(botToken);
  }

  async check(chatId: string, userId: number): Promise<MemberCheckResult> {
    try {
      const m = await this.api.getChatMember(chatId, userId);
      const isMember = 'is_member' in m ? (m as { is_member?: boolean }).is_member : undefined;
      return { kind: 'ok', status: m.status, isMember };
    } catch (err) {
      if (err instanceof GrammyError) {
        const d = err.description.toLowerCase();
        if (err.error_code === 400 && (d.includes('user not found') || d.includes('participant_id_invalid') || d.includes('member not found')))
          return { kind: 'not-member' };
        if (err.error_code === 429 || err.error_code >= 500) return { kind: 'unavailable', description: err.description };
        // 400 chat not found, 403 bot is not a member / was kicked, member list is inaccessible
        return { kind: 'config-error', description: err.description };
      }
      if (err instanceof HttpError) return { kind: 'unavailable', description: 'network' };
      return { kind: 'unavailable', description: (err as Error)?.message ?? 'unknown' };
    }
  }
}

/** Заглушка, когда BOT_TOKEN не задан: проверка невозможна */
export class NoTokenMemberChecker implements ChatMemberChecker {
  async check(): Promise<MemberCheckResult> {
    return { kind: 'config-error', description: 'BOT_TOKEN не задан' };
  }
}
