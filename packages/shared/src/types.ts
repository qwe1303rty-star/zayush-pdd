/** Контракты REST API между apps/api и apps/web */

export interface ApiError {
  error: { code: string; message: string };
}

export interface RankDTO {
  code: string;
  title: string;
  minXp: number;
  tagline: string;
  image: string;
  rewards: string[];
}

export interface MeDTO {
  user: {
    id: string;
    firstName: string;
    xp: number;
    streakDays: number;
    bestStreak: number;
    equippedCar: string;
    notificationsEnabled: boolean;
    isAdmin: boolean;
    isNew: boolean;
  };
  rank: { current: RankDTO; next: RankDTO | null; ratio: number; xpForNext: number | null };
  stats: StatsDTO;
  daily: { day: string; answered: number; goal: number; done: boolean; xp: number };
  lastTicket: { id: string; number: number; title: string; answered: number; total: number } | null;
  access: AccessDTO;
  isDemoContent: boolean;
}

export interface StatsDTO {
  answeredQuestions: number;
  correctQuestions: number;
  totalAnswers: number;
  accuracy: number; // 0..100
  totalQuestions: number;
  openMistakes: number;
  favorites: number;
  examsPassed: number;
  examsTotal: number;
  /** Готовность к экзамену 0..100 — доля вопросов, на которые последний ответ верный */
  readiness: number;
}

export interface AccessDTO {
  required: boolean;
  passed: boolean;
}

export interface TopicDTO {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  total: number;
  answered: number;
  correct: number;
}

export interface TicketDTO {
  id: string;
  number: number;
  title: string;
  isDemo: boolean;
  total: number;
  answered: number;
  correct: number;
}

/** Вопрос для клиента: без признака правильного ответа */
export interface QuestionDTO {
  id: string;
  externalId: string;
  text: string;
  scene: string | null;
  /** Подсказка до ответа (в экзамене не отдаётся) */
  hint: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  isDemo: boolean;
  options: { id: string; label: string; text: string }[];
  isFavorite: boolean;
  topic: { slug: string; title: string };
  ticket: { id: string; number: number } | null;
  /** Последний ответ пользователя на этот вопрос (для восстановления сессии) */
  lastAnswer: { optionId: string; isCorrect: boolean } | null;
}

export interface QuestionSetDTO {
  title: string;
  kind: 'ticket' | 'topic' | 'mistakes' | 'favorites' | 'daily';
  isDemo: boolean;
  questions: QuestionDTO[];
}

export interface AnswerRequest {
  questionId: string;
  optionId: string;
  mode: 'TRAINING' | 'MISTAKES' | 'DAILY';
  /** UUID, генерируется клиентом на каждую попытку ответа — для идемпотентности */
  clientAttemptId: string;
  ticketId?: string;
}

export interface ExplanationDTO {
  correctOptionId: string;
  explanation: string;
  takeaway: string | null;
  clauseRefs: string[];
  signRefs: string[];
  whyWrong: { optionId: string; text: string }[];
  sourceUrl: string | null;
}

export interface AnswerResultDTO {
  isCorrect: boolean;
  xpAwarded: number;
  totalXp: number;
  rankUp: RankDTO | null;
  achievementsUnlocked: { code: string; title: string }[];
  dailyCompleted: boolean;
  ticketCompleted: boolean;
  explanation: ExplanationDTO;
  duplicate: boolean;
}

export interface ExamConfigDTO {
  code: string;
  title: string;
  description: string;
  questions: number;
  minutes: number;
  maxErrors: number;
  available: boolean;
  unavailableReason: string | null;
  demo: boolean;
}

export interface ExamStateDTO {
  id: string;
  examCode: string;
  title: string;
  status: 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'EXPIRED';
  startedAt: string;
  deadlineAt: string;
  finishedAt: string | null;
  serverNow: string;
  items: { questionId: string; block: number; extra: boolean; answered: boolean }[];
  questions: QuestionDTO[];
  correct: number;
  wrong: number;
  reason: string | null;
  xpAwarded: number;
  isDemo: boolean;
}

export interface ExamResultReviewDTO {
  questionId: string;
  text: string;
  imageUrl: string | null;
  chosenOptionId: string | null;
  isCorrect: boolean | null;
  options: { id: string; label: string; text: string }[];
  explanation: ExplanationDTO;
}

export interface SignDTO {
  id: string;
  code: string;
  title: string;
  category: string;
  description: string;
  example: string | null;
  imageUrl: string;
  imageVerified: boolean;
  /** Ответственность по КоАП (на дату обновления набора) */
  penalty: string | null;
  isFavorite: boolean;
}

export const SIGN_CATEGORIES: { code: string; title: string }[] = [
  { code: 'warning', title: 'Предупреждающие' },
  { code: 'priority', title: 'Приоритета' },
  { code: 'prohibitory', title: 'Запрещающие' },
  { code: 'mandatory', title: 'Предписывающие' },
  { code: 'special', title: 'Особых предписаний' },
  { code: 'info', title: 'Информационные' },
  { code: 'service', title: 'Сервиса' },
  { code: 'plates', title: 'Таблички' },
  { code: 'markup', title: 'Разметка' },
];

/** Номер знака или линии разметки для показа. Коды разметки хранятся с префиксом «m» (m1.1), чтобы не путаться со знаками. */
export function signNumber(code: string): string {
  return code.startsWith('m') ? code.slice(1) : code;
}

export interface AssistantReplyDTO {
  answer: string;
  source: 'knowledge-base' | 'ai';
  matched: boolean;
  clauseRefs: string[];
  signRefs: string[];
  related: { kind: 'sign' | 'question' | 'topic'; id: string; title: string }[];
  needsVerification: boolean;
}

export interface GateSourceDTO {
  id: string;
  kind: 'CHANNEL' | 'GROUP';
  title: string;
  url: string;
  ok: boolean | null;
}

export interface GateStatusDTO {
  required: boolean;
  passed: boolean;
  sources: GateSourceDTO[];
  /** checking — ещё не проверяли; unavailable — Telegram API временно недоступен */
  state: 'not-required' | 'not-checked' | 'missing' | 'passed' | 'unavailable';
}

export interface GarageDTO {
  equippedCar: string;
  rewards: { code: string; kind: string; title: string; image: string; unlocked: boolean; unlockRank: string | null }[];
  achievements: { code: string; title: string; description: string; icon: string; xpReward: number; unlockedAt: string | null }[];
  ranks: (RankDTO & { reached: boolean })[];
}
