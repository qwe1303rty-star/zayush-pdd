import { Bot, type Context } from 'grammy';

export interface BotOptions {
  token: string;
  policyUrl?: string;
  onStart?: (from: { id: number; first_name: string }) => Promise<void>;
  onStop?: (fromId: number) => Promise<void>;
}

export const AGE_MARK = '12+';

export const BOT_TEXTS = {
  start: (name: string) =>
    `Привет, ${name}! 💗\n\nЯ Заюш — твоя подружка по ПДД. Напоминания и поддержка по учёбе.\n\n${AGE_MARK} · /help — что я умею · /privacy — как мы обращаемся с данными`,
  help:
    'Что я умею:\n\n' +
    '• /start — приветствие\n' +
    '• /help — эта подсказка\n' +
    '• /stop — выключить напоминания\n' +
    '• /privacy — персональные данные и удаление аккаунта\n\n' +
    'Важно: бот — помощник и напоминалка. Ориентируйся на официальный текст ПДД РФ.',
  privacy: (url?: string) =>
    'Мы храним только твой Telegram ID, имя и учебный прогресс — и только после твоего согласия. ' +
    'Удалить аккаунт и все данные: обратись к администратору.' +
    (url ? `\n\nПолитика обработки данных: ${url}` : ''),
  stop: 'Окей, кисуль, напоминания выключены. Включить снова можно в настройках 💗',
};

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function createBot(opts: BotOptions): Bot<Context> {
  const bot = new Bot(opts.token);

  bot.command('start', async (ctx) => {
    if (ctx.from && opts.onStart) {
      try {
        await opts.onStart(ctx.from);
      } catch (e) {
        console.error('onStart failed', e);
      }
    }
    const name = ctx.from?.first_name ?? 'заюш';
    await ctx.reply(BOT_TEXTS.start(name));
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(BOT_TEXTS.help);
  });

  bot.command('privacy', async (ctx) => {
    const url = opts.policyUrl && isHttpsUrl(opts.policyUrl) ? opts.policyUrl : undefined;
    await ctx.reply(BOT_TEXTS.privacy(url), { link_preview_options: { is_disabled: true } });
  });

  bot.command('stop', async (ctx) => {
    if (ctx.from && opts.onStop) await opts.onStop(ctx.from.id);
    await ctx.reply(BOT_TEXTS.stop);
  });

  bot.on('message', async (ctx) => {
    await ctx.reply('Привет! Напиши /help, чтобы узнать, что я умею 💗');
  });

  bot.catch((err) => {
    console.error('Bot error', err.error);
  });

  return bot;
}

export async function configureBot(bot: Bot<Context>) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Приветствие' },
    { command: 'help', description: 'Что умеет бот' },
    { command: 'stop', description: 'Выключить напоминания' },
    { command: 'privacy', description: 'Персональные данные' },
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
}
