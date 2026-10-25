import type { Env } from './env.js';
import type { Db } from './db.js';
import type { AssistantService } from './services/assistant.js';
import type { ExamService } from './services/exam.js';
import type { LearningService } from './services/learning.js';
import type { Notifier } from './services/notify.js';
import type { ProfileService } from './services/profile.js';
import type { SettingsService } from './services/settings.js';
import type { SubscriptionService } from './services/subscription.js';
import type { LegalService } from './services/legal.js';
import type { SmsSender } from './services/sms.js';
import type { ActivityService } from './services/activity.js';
import type { User } from './generated/prisma/client.js';

export interface AppContext {
  env: Env;
  db: Db;
  settings: SettingsService;
  learning: LearningService;
  exam: ExamService;
  subscription: SubscriptionService;
  profile: ProfileService;
  assistant: AssistantService;
  notifier: Notifier;
  legal: LegalService;
  sms: SmsSender;
  activity: ActivityService;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
    isAdmin: boolean;
  }
}
