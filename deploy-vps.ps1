#Requires -RunAsAdministrator
<#
  Деплой «Заюш ПДД» на Windows VPS.

  В скрипте нет секретов: отсутствующие значения запрашиваются интерактивно,
  случайные секреты генерируются автоматически.

  Пример:
    .\deploy-vps.ps1 -Domain https://pdd.example.ru -NodeEnv development

  Для публичного запуска (NodeEnv production) обязательны данные оператора ПДн:
    -LegalOperatorName "ИП Иванова И.И." -LegalOperatorInn 123456789012 -LegalContactEmail mail@example.ru
#>
param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [string]$ProjectDir = "C:\apps\zayush-pdd",
  [string]$ArchivePath = "",
  [ValidateSet("development", "production")][string]$NodeEnv = "development",
  [string]$DbPassword = "",
  [string]$PostgresPassword = "",
  [string]$BotToken = "",
  [string]$AdminTelegramIds = "",
  [string]$AdminApiToken = "",
  [string]$LegalOperatorName = "",
  [string]$LegalOperatorInn = "",
  [string]$LegalContactEmail = "",
  [string]$PdHashSecret = ""
)

$ErrorActionPreference = "Stop"

function New-Secret([int]$Length = 48) {
  return -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $Length | ForEach-Object { [char]$_ })
}

function Write-EnvFile([string]$Path, [string]$Content) {
  # UTF-8 без BOM: Node корректно читает первую переменную
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "=== Zayush PDD VPS deploy ===" -ForegroundColor Cyan

if (-not $DbPassword) { $DbPassword = Read-Host "Пароль пользователя БД zayush" }
if (-not $PostgresPassword) { $PostgresPassword = Read-Host "Пароль суперпользователя postgres" }
if (-not $BotToken) { $BotToken = Read-Host "BOT_TOKEN от @BotFather (новый, не из старых файлов)" }
if (-not $AdminTelegramIds) { $AdminTelegramIds = Read-Host "Telegram ID администратора (узнать у @userinfobot)" }
if (-not $AdminApiToken) { $AdminApiToken = New-Secret 48 }
if (-not $PdHashSecret) { $PdHashSecret = New-Secret 48 }
$webhookSecret = New-Secret 32

if ($NodeEnv -eq "production") {
  foreach ($pair in @(
      @{ Name = "LegalOperatorName"; Value = $LegalOperatorName },
      @{ Name = "LegalOperatorInn"; Value = $LegalOperatorInn },
      @{ Name = "LegalContactEmail"; Value = $LegalContactEmail }
    )) {
    if (-not $pair.Value) { throw "Для NODE_ENV=production обязателен параметр -$($pair.Name)" }
  }
}

# 1. Node.js 22 LTS
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Устанавливаю Node.js LTS..." -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
node --version

# 2. PostgreSQL 16
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Host "Устанавливаю PostgreSQL..." -ForegroundColor Yellow
  winget install --id PostgreSQL.PostgreSQL --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
psql --version

# 3. Распаковка проекта
if ($ArchivePath -and (Test-Path $ArchivePath)) {
  if (-not (Test-Path "C:\apps")) { New-Item -ItemType Directory -Path "C:\apps" | Out-Null }
  tar -xzf $ArchivePath -C "C:\apps"
}
if (-not (Test-Path $ProjectDir)) { throw "Каталог проекта не найден: $ProjectDir" }
Set-Location $ProjectDir

# 4. Зависимости
if (Test-Path "package-lock.json") { npm ci } else { npm install }

# 5. .env
$envContent = @"
NODE_ENV=$NodeEnv
PORT=8080
DATABASE_URL=postgresql://zayush:$DbPassword@127.0.0.1:5432/zayush
WEBAPP_URL=$Domain
PUBLIC_API_URL=$Domain
BOT_TOKEN=$BotToken
BOT_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=$webhookSecret
INITDATA_MAX_AGE_SEC=86400
ADMIN_TELEGRAM_IDS=$AdminTelegramIds
ADMIN_API_TOKEN=$AdminApiToken
DEV_AUTH_BYPASS=false
REQUIRE_SUBSCRIPTION=false
REMINDERS_ENABLED=false
UPLOAD_DIR=$ProjectDir\uploads
WEB_DIST_DIR=$ProjectDir\apps\web\dist
CORS_ORIGINS=$Domain
LEGAL_OPERATOR_NAME=$LegalOperatorName
LEGAL_OPERATOR_INN=$LegalOperatorInn
LEGAL_CONTACT_EMAIL=$LegalContactEmail
PD_HASH_SECRET=$PdHashSecret
"@
Write-EnvFile "$ProjectDir\.env" $envContent
Write-Host ".env создан (UTF-8 без BOM). ADMIN_API_TOKEN и PD_HASH_SECRET сохранены в нём." -ForegroundColor Green

# 6. База данных
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
if ((Test-Path "$pgBin\psql.exe") -and ($env:Path -notlike "*$pgBin*")) { $env:Path += ";$pgBin" }
$env:PGPASSWORD = $PostgresPassword
& psql -U postgres -h 127.0.0.1 -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='zayush') THEN CREATE USER zayush WITH PASSWORD '$DbPassword'; END IF; END `$`$;" | Out-Null
& psql -U postgres -h 127.0.0.1 -tc "SELECT 1 FROM pg_database WHERE datname='zayush'" | Out-Null
$dbExists = (& psql -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname='zayush'").Trim()
if ($dbExists -ne "1") { & psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE zayush OWNER zayush;" | Out-Null }
$env:PGPASSWORD = $DbPassword
npx prisma migrate deploy
npm run db:seed

# 7. Сборка
npm run build

# 8. Служба NSSM
if (-not (Test-Path "$ProjectDir\logs")) { New-Item -ItemType Directory -Path "$ProjectDir\logs" | Out-Null }
$Nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $Nssm) {
  Write-Host "Скачиваю NSSM..." -ForegroundColor Yellow
  $zip = "$env:TEMP\nssm.zip"
  Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath "C:\tools" -Force
  $Nssm = "C:\tools\nssm-2.24\win64\nssm.exe"
}
& $Nssm stop ZayushPDD 2>$null
& $Nssm remove ZayushPDD confirm 2>$null
& $Nssm install ZayushPDD "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=$ProjectDir\.env $ProjectDir\apps\api\dist\server.js"
& $Nssm set ZayushPDD AppDirectory $ProjectDir
& $Nssm set ZayushPDD AppStdout "$ProjectDir\logs\stdout.log"
& $Nssm set ZayushPDD AppStderr "$ProjectDir\logs\stderr.log"
& $Nssm set ZayushPDD Start SERVICE_AUTO_START
& $Nssm start ZayushPDD

Write-Host "=== Готово ===" -ForegroundColor Green
Write-Host "API: http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "Следующий шаг: HTTPS reverse proxy (Caddy) на домен $Domain — см. DEPLOY-VPS.md" -ForegroundColor Yellow
