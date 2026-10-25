/**
 * Отдельный запуск бота в режиме long polling (удобно для локальной разработки).
 * В production рекомендуется запускать бота внутри API (BOT_MODE=webhook или polling),
 * чтобы /start отмечал в БД, что бот может присылать напоминания.
 */
import { configureBot, createBot } from './index.js';

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL ?? '';
if (!token) {
  console.error('BOT_TOKEN не задан. Скопируйте .env.example в .env и укажите токен от @BotFather.');
  process.exit(1);
}

const bot = createBot({ token, webAppUrl });
await bot.api.deleteWebhook({ drop_pending_updates: false });
await configureBot(bot, webAppUrl);
console.log('Бот запущен в режиме polling');
await bot.start();
