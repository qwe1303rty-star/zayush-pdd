import { describe, expect, it } from 'vitest';
import { BOT_TEXTS, createBot, isHttpsUrl } from './index.js';

describe('бот', () => {
  it('Mini App / web_app кнопок больше нет', () => {
    expect(JSON.stringify(BOT_TEXTS)).not.toMatch(/web_app/);
  });

  it('Mini App открывается только по HTTPS', () => {
    expect(isHttpsUrl('https://a.b')).toBe(true);
    expect(isHttpsUrl('http://localhost:5173')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
  });

  it('создаётся без сетевых запросов', () => {
    const bot = createBot({ token: '123:abc' });
    expect(bot).toBeTruthy();
  });

  it('тексты не содержат токенов и секретов', () => {
    expect(JSON.stringify(BOT_TEXTS)).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);
  });
});
