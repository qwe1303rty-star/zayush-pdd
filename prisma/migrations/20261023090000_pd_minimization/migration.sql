-- 152-ФЗ: минимизация ПДн — username и язык интерфейса Telegram больше не храним
ALTER TABLE "User" DROP COLUMN IF EXISTS "username";
ALTER TABLE "User" DROP COLUMN IF EXISTS "languageCode";

-- Срок хранения: дата последнего входа для удаления неактивных аккаунтов
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- Пользователи, созданные до появления экрана согласия, должны дать согласие заново:
-- их consentVersion остаётся NULL, и приложение покажет экран согласия при следующем входе.
