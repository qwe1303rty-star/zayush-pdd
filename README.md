# Заюш ПДД 💗👑

Telegram Mini App для изучения ПДД РФ: белый зайчик в золотой короне, розовая машинка и голос «подружки из соцсетей» — снаружи милота и юмор, внутри настоящие правила, проверенные по тексту ПДД.

> Загружены **все 40 экзаменационных билетов категорий A, B, M** (800 вопросов) из открытого набора [etspring/pdd_russia](https://github.com/etspring/pdd_russia) (обновление 2026.q3). Варианты ответов, правильные ответы, картинки и пояснения — из набора. Формулировка вопроса в тренировке переписана в стиле «Заюш», в экзамене показывается официальная. См. [docs/content-import.md](docs/content-import.md).

## Что внутри

| Модуль | Стек | Назначение |
|---|---|---|
| `apps/web` | React 19, TypeScript, Vite 8, Tailwind CSS 4, TanStack Query, официальный `telegram-web-app.js` | Mini App + админ-панель (`/admin`, отдельный lazy-чанк) |
| `apps/api` | Node.js 22, Fastify 5, Prisma 7, PostgreSQL, zod | REST API, проверка initData, учебная логика, XP, экзамен, подписка, админка |
| `apps/bot` | grammY | `/start`, `/help`, `/stop`, кнопка «Открыть Заюш ПДД», меню-кнопка; webhook или polling |
| `packages/shared` | TypeScript | Контракты API, движок экзамена, ранги, баланс XP, словарь фраз, конфиг подписки |
| `prisma/` | Prisma | Схема БД и миграции |
| `content/abm/` | JSON | Билеты A/B/M, знаки и разметка (`content.json` собирается скриптом), формулировки «Заюш» (`style/*.json`) |
| `content/*.json` | JSON | База ответов помощника, описания и примеры к знакам |
| `scripts/` | Node | Сборка контента из набора pdd_russia, dev-запуск |

Подробности: [docs/architecture.md](docs/architecture.md).

## Быстрый старт (локально)

Нужны Node.js ≥ 22 и PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # заполните DATABASE_URL; для работы в браузере: DEV_AUTH_BYPASS=true
npx prisma migrate deploy     # создать таблицы
npx prisma generate           # сгенерировать Prisma Client
npm run db:seed               # ранги, достижения и демо-контент
npm run dev                   # API на :8080 + Vite на :5173
```

Откройте http://localhost:5173 — при `DEV_AUTH_BYPASS=true` вы войдёте тестовым пользователем «Разработчица» (только вне production).

Внутри Telegram Mini App открывается только по **HTTPS**. Для разработки используйте туннель (например, `cloudflared tunnel --url http://localhost:5173` или ngrok) и укажите полученный адрес в `WEBAPP_URL` и в @BotFather.

## Переменные окружения

Полный список с комментариями — в [`.env.example`](.env.example). Главное:

| Переменная | Зачем |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `BOT_TOKEN` | Токен бота от @BotFather. **Только на сервере**: им проверяется подпись initData и вызывается Bot API |
| `WEBAPP_URL` | HTTPS-адрес Mini App |
| `BOT_MODE` | `off` / `polling` / `webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | Секрет webhook (16+ символов) |
| `ADMIN_TELEGRAM_IDS` | Telegram ID админов через запятую |
| `ADMIN_API_TOKEN` | Вход в `/admin` из браузера (32+ символа в production) |
| `REQUIRE_SUBSCRIPTION`, `REQUIRED_CHANNELS`, `REQUIRED_GROUPS` | Опциональная обязательная подписка |
| `DEV_AUTH_BYPASS` | Только для разработки; в production сервер откажется стартовать |

## Ранги

Названия и пороги совпадают с картинками рангов (`apps/web/public/brand/rank-r1…r8.webp`):

| Ранг | XP | Ранг | XP |
|---|---|---|---|
| Новичок | 0 | Принцесса | 1000 |
| Ученица | 100 | Королева | 1500 |
| Стильная | 300 | Топ-модель | 2500 |
| Мечтательница | 600 | Звезда дорог | 4000 |

Название ранга напечатано на самой картинке, поэтому если переименовываете ранг в админке — замените и картинку. Базы, созданные первой версией, обновляются до этих рангов автоматически при старте сервера (ранги, которые вы уже меняли в админке, не трогаются).

## Подключение вашего Telegram-бота

Коротко (подробно — [docs/telegram-setup.md](docs/telegram-setup.md)):

1. Впишите токен в `.env` → `BOT_TOKEN=...` (не в код и не в README).
2. `WEBAPP_URL=https://ваш-домен`, `BOT_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET=<случайная строка>`.
3. Запустите сервер — он сам зарегистрирует webhook, команды и меню-кнопку.
4. В @BotFather → *Bot Settings → Configure Mini App* укажите тот же URL (по желанию — для прямой ссылки `t.me/ваш_бот/app`).

## Обязательная подписка: включить / выключить

- **Выключить:** `REQUIRE_SUBSCRIPTION=false` (по умолчанию) или тумблер в `/admin → Подписка`. Экран проверки не показывается, запросов к Telegram нет.
- **Включить:** добавьте источники в `.env` или в админке и включите тумблер:
  ```env
  REQUIRE_SUBSCRIPTION=true
  REQUIRED_CHANNELS=@zayush_channel||Канал Заюша
  REQUIRED_GROUPS=-1001234567890|https://t.me/+AbCdEf|Чат Заюша
  ```
- Бот должен быть **администратором канала** и **участником (лучше администратором) группы** — иначе Telegram не отдаёт `getChatMember`. Подробно — в [docs/telegram-setup.md](docs/telegram-setup.md#обязательная-подписка).

При первом старте источники из `.env` переносятся в БД; дальше ими удобно управлять из админки (значение флага в админке главнее `.env`).

## Скрипты

```bash
npm run dev            # API + web
npm run build          # сборка всех пакетов
npm run typecheck      # проверка типов
npm test               # все тесты (API-тесты используют БД zayush_test или TEST_DATABASE_URL)
npm run db:seed        # билеты A/B/M, знаки, разметка + ранги/достижения
npm run content:import -- path/to/content.json [--dry-run]
node scripts/build-abm-content.mjs ../pdd_russia   # пересобрать content/abm/content.json и картинки
```

## Деплой

```bash
cp .env.example .env   # NODE_ENV=production, BOT_TOKEN, WEBAPP_URL, BOT_MODE=webhook, секреты
docker compose up -d --build
docker compose exec app npm run db:seed   # однократно: билеты, знаки и разметка
```

Контейнер применяет миграции при старте и раздаёт Mini App и API с одного домена (порт 8080). Поставьте перед ним HTTPS-прокси (Caddy/nginx/Traefik). Без Docker: `npm ci && npx prisma generate && npm run build && npx prisma migrate deploy && NODE_ENV=production WEB_DIST_DIR=apps/web/dist node apps/api/dist/server.js`.

## Что пока на демо-данных / не подключено

- **Вопросы:** 800 вопросов 40 билетов A, B, M из открытого набора pdd_russia. У репозитория набора нет файла лицензии — перед публичным запуском согласуйте использование пояснений с автором набора или замените их своими. Вопросы и картинки экзаменационных билетов — официальные материалы.
- **Подсказки:** у 643 вопросов есть подсказка (номер пункта ПДД из пояснения); у остальных кнопки «Подсказка» нет.
- **Знаки:** все 310 знаков Приложения 1 и 47 линий разметки с описаниями из набора. У 22 знаков (в основном таблички 8.4.x) в наборе нет изображения — показана заглушка с номером; загрузите изображения в админке. Описания 30 знаков, которых не было в наборе, написаны по Приложению 1. Суммы штрафов в карточках — на дату обновления набора.
- **Помощник «Спроси Заюша»:** отвечает только по проверенной базе (22 объяснения + каталог знаков). AI-адаптер (Anthropic) реализован, но выключен; распознавания фото нет.
- **Уведомления:** работают при `BOT_MODE≠off`, `REMINDERS_ENABLED=true`, если пользователь нажал /start и включил уведомления. Планировщик — простой in-process таймер (для нескольких инстансов вынесите в отдельный воркер).
- **Ассеты бренда:** ранги, стикеры и предметы — из присланных исходников в высоком качестве; зайчик за рулём и цветные машинки вырезаны из концептов, эмблема производителя закрыта сердечком (для релиза лучше получить их исходники). Надпись «Заюш ПДД» сделана шрифтом.

## Законы РФ: персональные данные, вход, 12+

Подробный чек-лист — [docs/legal.md](docs/legal.md). Коротко:

- **152-ФЗ.** Учётная запись создаётся только после экрана согласия; документы `/legal/privacy`, `/legal/consent`, `/legal/terms`, `/legal/licenses` открываются без входа (ссылку на политику укажите в BotFather). Удаление аккаунта — в настройках. Храним только Telegram ID, имя и учебные данные; неактивные аккаунты удаляются через `RETENTION_INACTIVE_DAYS`. В production без `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_INN`, `LEGAL_CONTACT_EMAIL`, `PD_HASH_SECRET` сервер не запустится.
- **149-ФЗ.** `AUTH_RU_PHONE_REQUIRED=true` включает подтверждение российского номера по SMS (sms.ru).
- **436-ФЗ.** Маркировка 12+.
- **Лицензии.** Пояснения ко всем 800 вопросам — собственные (`content/abm/explain`), недостающие знаки — с Wikimedia Commons с указанием авторства, список npm-лицензий — `npm run licenses`.

## Перед публичным запуском

1. Согласовать использование пояснений из набора pdd_russia (или заменить своими) и выборочно выверить ответы с инструктором.
2. Загрузить изображения 22 знаков без картинки и сверить остальные с ГОСТ Р 52290-2024; проверить актуальность штрафов КоАП.
3. Пройти чек-лист [docs/legal.md](docs/legal.md): данные оператора ПДн, уведомление в Роскомнадзор, сервер в РФ, вход по российскому номеру (AUTH_RU_PHONE_REQUIRED), ссылка на политику в BotFather.
4. Политика конфиденциальности (хранятся Telegram ID, имя, username, учебная статистика).
5. HTTPS, резервные копии БД, мониторинг, длинный случайный `ADMIN_API_TOKEN`.
6. Сверить параметры экзамена с актуальной редакцией регламента (ПП РФ № 1097, приказ МВД № 80).

## Деплой на GitHub Pages (фронтенд) + бесплатный backend

Фронтенд можно разместить бесплатно на GitHub Pages (workflow `.github/workflows/pages.yml` уже добавлен). Backend (Node + PostgreSQL) на GitHub не работает — его нужно разместить отдельно (Render/Fly.io + Neon/Supabase). Шаги:

1. В GitHub репозитории: **Settings → Pages → Source → GitHub Actions**.
2. В **Settings → Secrets and variables → Actions → Variables** добавьте `MINI_APP_API_BASE=https://your-backend.example` (адрес backend без слэша в конце).
3. Backend (например Render, free tier):
   - Build: `npm ci && npx prisma generate && npm run build`
   - Start: `npx prisma migrate deploy && node apps/api/dist/server.js`
   - Env: `NODE_ENV=production`, `DATABASE_URL`, `BOT_TOKEN`, `WEBAPP_URL=https://<user>.github.io/zayush-pdd/`, `BOT_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET`, `CORS_ORIGINS=https://<user>.github.io`, `LEGAL_*`, `PD_HASH_SECRET` и т.д.
   - Один раз выполните `npm run db:seed` (через shell Render) — билеты, знаки, разметка.
4. В @BotFather укажите Mini App URL = `https://<user>.github.io/zayush-pdd/`.
5. После push в `main` workflow соберёт и опубликует фронтенд. Если `MINI_APP_API_BASE` пуст — приложение будет искать API на том же домене и не заработает.

Локальная разработка по-прежнему: `npm run dev` (API :8080 + Vite :5173).

## Тесты

70 тестов (Vitest): движок экзамена по правилам ГИБДД, ранги и XP, конфиг подписки, бот, интеграционные тесты API на реальной PostgreSQL — проверка initData и подмены пользователя, серверная проверка ответа, однократность XP, идемпотентность повторной отправки, исправление ошибок, повышение ранга, восстановление прогресса, экзамен с доп. вопросами, подписка (выкл/вкл/не подписан/сбой Telegram/льгота), права админа, запрет загрузки SVG, согласие на обработку ПДн и удаление аккаунта, подтверждение российского номера, сроки хранения, проверки production-конфигурации.
