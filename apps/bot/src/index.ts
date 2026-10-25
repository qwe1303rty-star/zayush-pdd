import { Bot, InlineKeyboard, type Context } from 'grammy';

export interface BotOptions {
  token: string;
  /** HTTPS-адрес Mini App */
  webAppUrl: string;
  /** Ссылка на политику обработки персональных данных (HTTPS) */
  policyUrl?: string;
  /** Вызывается при /start — например, чтобы отметить, что бот может писать пользователю */
  onStart?: (from: { id: number; first_name: string }) => Promise<void>;
  /** Вызывается при /stop — пользователь отказался от уведомлений */
  onStop?: (fromId: number) => Promise<void>;
}

/** Возрастная маркировка (436-ФЗ) */
export const AGE_MARK = '12+';

export const BOT_TEXTS = {
  start: (name: string) =>
    `Привет, ${name}! 💗\n\nЯ Заюш — твоя подружка по ПДД. Билеты, знаки, экзамен как в ГИБДД, разборы ошибок и розовая машинка в награду 👑\n\nЖми кнопку — и погнали учиться! При первом входе я попрошу согласие на обработку данных.\n\n${AGE_MARK} · /privacy — как мы обращаемся с данными`,
  help:
    'Что я умею:\n\n' +
    '• /start — открыть Заюш ПДД\n' +
    '• /help — эта подсказка\n' +
    '• /stop — выключить напоминания\n' +
    '• /privacy — персональные данные и удаление аккаунта\n\n' +
    'Учёба проходит в мини-приложении: билеты, экзамен, знаки, «Мои ошибки» и помощник «Спроси Заюша».\n\n' +
    'Важно: приложение — тренажёр. Ориентируйся на официальный текст ПДД РФ, а результат в приложении не гарантирует сдачу экзамена в ГИБДД.',
  privacy: (url?: string) =>
    'Мы храним только твой Telegram ID, имя и учебный прогресс — и только после твоего согласия в приложении. ' +
    'Удалить аккаунт и все данные: Профиль → Настройки → «Удалить аккаунт и данные».' +
    (url ? `\n\nПолитика обработки данных: ${url}` : ''),
  stop: 'Окей, кисуль, напоминания выключены. Включить снова можно в настройках приложения 💗',
  openButton: 'Открыть Заюш ПДД',
  notHttps:
    'Мини-приложение ещё не подключено: владельцу бота нужно указать HTTPS-адрес в WEBAPP_URL. Telegram открывает Mini App только по HTTPS.',
};

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function openKeyboard(webAppUrl: string) {
  return new InlineKeyboard().webApp(BOT_TEXTS.openButton, webAppUrl);
}

export function createBot(opts: BotOptions): Bot<Context> {
  const bot = new Bot(opts.token);
  const canOpen = isHttpsUrl(opts.webAppUrl);

  bot.command('start', async (ctx) => {
    if (ctx.from && opts.onStart) {
      try {
        await opts.onStart(ctx.from);
      } catch (e) {
        console.error('onStart failed', e);
      }
    }
    const name = ctx.from?.first_name ?? 'заюш';
    if (!canOpen) return ctx.reply(`${BOT_TEXTS.start(name)}\n\n${BOT_TEXTS.notHttps}`);
    await ctx.reply(BOT_TEXTS.start(name), { reply_markup: openKeyboard(opts.webAppUrl) });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(BOT_TEXTS.help, canOpen ? { reply_markup: openKeyboard(opts.webAppUrl) } : {});
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
    await ctx.reply('Я учу ПДД в мини-приложении 💗 Нажми кнопку ниже или напиши /help.', canOpen ? { reply_markup: openKeyboard(opts.webAppUrl) } : {});
  });

  bot.catch((err) => {
    console.error('Bot error', err.error);
  });

  return bot;
}

/** Настраивает команды и кнопку меню (Menu Button), открывающую Mini App */
export async function configureBot(bot: Bot<Context>, webAppUrl: string) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Открыть Заюш ПДД' },
    { command: 'help', description: 'Что умеет бот' },
    { command: 'stop', description: 'Выключить напоминания' },
    { command: 'privacy', description: 'Персональные данные' },
  ]);
  if (isHttpsUrl(webAppUrl)) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Заюш ПДД', web_app: { url: webAppUrl } } });
  }
}
