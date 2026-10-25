import { describe, expect, it } from 'vitest';
import { BOT_TEXTS, createBot, isHttpsUrl, openKeyboard } from './index.js';

describe('бот', () => {
  it('кнопка открывает Mini App по web_app URL', () => {
    const kb = openKeyboard('https://zayush.example');
    const btn = kb.inline_keyboard[0][0] as { text: string; web_app?: { url: string } };
    expect(btn.text).toBe(BOT_TEXTS.openButton);
    expect(btn.web_app?.url).toBe('https://zayush.example');
  });

  it('Mini App открывается только по HTTPS', () => {
    expect(isHttpsUrl('https://a.b')).toBe(true);
    expect(isHttpsUrl('http://localhost:5173')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
  });

  it('создаётся без сетевых запросов', () => {
    const bot = createBot({ token: '123:abc', webAppUrl: 'https://zayush.example' });
    expect(bot).toBeTruthy();
  });

  it('тексты не содержат токенов и секретов', () => {
    expect(JSON.stringify(BOT_TEXTS)).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);
  });
});
