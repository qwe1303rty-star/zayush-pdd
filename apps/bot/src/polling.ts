/**
 * Отдельный запуск бота в режиме long polling (удобно для локальной разработки).
 */
import { configureBot, createBot } from './index.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан. Скопируйте .env.example в .env и укажите токен от @BotFather.');
  process.exit(1);
}

const bot = createBot({ token });
await bot.api.deleteWebhook({ drop_pending_updates: false });
await configureBot(bot);
console.log('Бот запущен в режиме polling');
await bot.start();
