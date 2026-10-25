# Деплой на Windows VPS

> Здесь нет реальных адресов и паролей — заполните значения самостоятельно.
> Для закрытой беты достаточно `NODE_ENV=development`; для публичного запуска нужен `production`
> и данные оператора ПДн (см. `docs/legal.md`).

## 1. Подключение

1. Откройте RDP: `mstsc /v:<IP>:<ПОРТ>`, логин и пароль выдаёт хостинг.
2. Скопируйте архив проекта на VPS (через буфер обмена или RDP-диск).

## 2. Установка зависимостей (PowerShell от администратора)

```powershell
# Node.js 22 LTS
winget install OpenJS.NodeJS.LTS
# PostgreSQL 16
winget install PostgreSQL.PostgreSQL
# Перезапустите PowerShell
node --version
psql --version
```

Если `winget` недоступен (старая Windows Server) — скачайте MSI вручную с nodejs.org и postgresql.org.

## 3. Распаковка и установка

```powershell
cd C:\apps
tar -xzf zayush-pdd-deploy.tar.gz
cd zayush-pdd
npm ci
npx prisma generate
```

## 4. Настройка `.env`

Создайте `C:\apps\zayush-pdd\.env` **в UTF-8 без BOM**. Секреты сгенерируйте, не придумывайте:

```powershell
# 32+ символа
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
```

```env
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://zayush:<ПАРОЛЬ_БД>@127.0.0.1:5432/zayush

WEBAPP_URL=https://<ДОМЕН>
PUBLIC_API_URL=https://<ДОМЕН>

BOT_TOKEN=<НОВЫЙ_ТОКЕН_ОТ_BOTFATHER>
BOT_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=<32+ СЛУЧАЙНЫХ СИМВОЛА>
INITDATA_MAX_AGE_SEC=86400

ADMIN_TELEGRAM_IDS=<ВАШ_TELEGRAM_ID>
ADMIN_API_TOKEN=<32+ СЛУЧАЙНЫХ СИМВОЛА>
DEV_AUTH_BYPASS=false

REQUIRE_SUBSCRIPTION=false
REMINDERS_ENABLED=false

UPLOAD_DIR=C:\apps\zayush-pdd\uploads
WEB_DIST_DIR=C:\apps\zayush-pdd\apps\web\dist
CORS_ORIGINS=https://<ДОМЕН>

# Обязательно для NODE_ENV=production (152-ФЗ)
LEGAL_OPERATOR_NAME=<ФИО ИП / название организации>
LEGAL_OPERATOR_INN=<ИНН>
LEGAL_CONTACT_EMAIL=<E-MAIL ДЛЯ ОБРАЩЕНИЙ>
PD_HASH_SECRET=<32+ СЛУЧАЙНЫХ СИМВОЛА>
```

> Для закрытой беты можно поставить `NODE_ENV=development` и не заполнять `LEGAL_OPERATOR_*`.
> `DEV_AUTH_BYPASS` должен оставаться `false` в любом случае.

## 5. База данных

```powershell
# Создать пользователя и БД (psql от postgres)
psql -U postgres -c "CREATE USER zayush WITH PASSWORD '<ПАРОЛЬ_БД>';"
psql -U postgres -c "CREATE DATABASE zayush OWNER zayush;"
cd C:\apps\zayush-pdd
npx prisma migrate deploy
npm run db:seed
```

## 6. Сборка

```powershell
npm run build
```

## 7. Запуск

```powershell
npm run start -w @zayush/api
```

API будет на `http://127.0.0.1:8080` и отдаст фронтенд из `apps/web/dist`.

## 8. Автозапуск (NSSM)

```powershell
nssm install ZayushPDD "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=C:\apps\zayush-pdd\.env C:\apps\zayush-pdd\apps\api\dist\server.js"
nssm set ZayushPDD AppDirectory "C:\apps\zayush-pdd"
nssm set ZayushPDD AppStdout "C:\apps\zayush-pdd\logs\stdout.log"
nssm set ZayushPDD AppStderr "C:\apps\zayush-pdd\logs\stderr.log"
nssm start ZayushPDD
```

## 9. HTTPS

Telegram Mini App открывается только по HTTPS с валидным сертификатом.

1. Домен: DNS `A` → `<IP VPS>`.
2. Откройте порты 80/443 в Windows Firewall **и** в панели хостинга.
3. Поставьте Caddy и создайте `C:\Caddy\Caddyfile`:

```
<ДОМЕН> {
    reverse_proxy 127.0.0.1:8080
}
```

4. Запустите Caddy как службу (`caddy run` через NSSM или `sc.exe create`).

Проверка: `https://<ДОМЕН>/api/health` → `{"ok":true}`.

## 10. Webhook бота

При `BOT_MODE=webhook` API сам регистрирует webhook при старте:

```powershell
nssm restart ZayushPDD
```

Проверить: `https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo` (не вставляйте токен в чаты и скриншоты).

В @BotFather: *Bot Settings → Configure Mini App → URL =* `https://<ДОМЕН>`.
