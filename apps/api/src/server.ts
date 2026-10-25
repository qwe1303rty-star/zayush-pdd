import { configureBot, createBot, isHttpsUrl } from '@zayush/bot';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { seedDefaults } from './services/content-import.js';
import { startReminderJob } from './services/notify.js';
import { startRetentionJob } from './services/retention.js';

const env = loadEnv();

// Бот создаётся до приложения, чтобы его API можно было использовать для уведомлений.
// Обработчики /start и /stop получают доступ к БД через ctx ниже.
let onStart: Parameters<typeof createBot>[0]['onStart'];
let onStop: Parameters<typeof createBot>[0]['onStop'];
const bot =
  env.BOT_TOKEN && env.BOT_MODE !== 'off'
    ? createBot({
        token: env.BOT_TOKEN,
        policyUrl: `${(env.PUBLIC_API_URL || env.WEBAPP_URL).replace(/\/$/, '')}/legal/privacy`,
        onStart: (from) => onStart?.(from) ?? Promise.resolve(),
        onStop: (id) => onStop?.(id) ?? Promise.resolve(),
      })
    : null;

const { app, ctx } = await buildApp({ env, bot });

// /start в боте НЕ создаёт учётную запись: она появляется только после согласия в Mini App (152-ФЗ).
// Если запись уже есть — отмечаем, что бот может писать пользователю.
onStart = async (from) => {
  await ctx.db.user.updateMany({ where: { telegramId: BigInt(from.id) }, data: { botCanWrite: true } });
};
onStop = async (id) => {
  await ctx.db.user.updateMany({ where: { telegramId: BigInt(id) }, data: { notificationsEnabled: false } });
};

await seedDefaults(ctx.db);
await ctx.subscription.syncFromEnv();

await app.listen({ port: env.PORT, host: env.HOST });

if (bot) {
  try {
    await bot.init();
    if (isHttpsUrl(env.WEBAPP_URL)) {
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'Открыть Заюш ПДД', web_app: { url: env.WEBAPP_URL } },
      });
      await bot.api.setMyCommands([
        { command: 'start', description: 'Приветствие' },
        { command: 'help', description: 'Что умеет бот' },
        { command: 'stop', description: 'Выключить напоминания' },
        { command: 'privacy', description: 'Персональные данные' },
      ]);
      app.log.info(`Меню-кнопка Mini App установлена: ${env.WEBAPP_URL}`);
    } else {
      await configureBot(bot);
      app.log.warn('WEBAPP_URL не HTTPS — меню-кнопка Mini App не установлена');
    }
    if (env.BOT_MODE === 'webhook') {
      const base = (env.PUBLIC_API_URL || env.WEBAPP_URL).replace(/\/$/, '');
      await bot.api.setWebhook(`${base}/telegram/webhook`, {
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'my_chat_member'],
      });
      app.log.info(`Webhook установлен: ${base}/telegram/webhook`);
    } else {
      await bot.api.deleteWebhook();
      void bot.start({ onStart: () => app.log.info(`Бот @${bot.botInfo.username} запущен (polling)`) });
    }
  } catch (e) {
    app.log.error({ err: (e as Error).message }, 'Не удалось запустить бота — проверьте BOT_TOKEN');
  }
}

if (env.remindersEnabled && bot) startReminderJob(ctx.notifier, env.REMINDER_HOUR_MSK, app.log);
startRetentionJob(ctx.db, env.RETENTION_INACTIVE_DAYS, env.ACTIVITY_RETENTION_DAYS, app.log);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (bot?.isRunning()) await bot.stop();
    await app.close();
    process.exit(0);
  });
}
