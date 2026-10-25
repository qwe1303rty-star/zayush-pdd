-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "hint" TEXT;

-- Стикеры заменены на новые картинки в высоком качестве: переносим коды у пользователей
UPDATE "UserReward" SET "rewardCode" = CASE "rewardCode"
  WHEN 'sticker-support' THEN 'sticker-hello'
  WHEN 'sticker-surprise' THEN 'sticker-wow'
  WHEN 'sticker-win' THEN 'sticker-wink'
  WHEN 'sticker-shy' THEN 'sticker-smile'
  WHEN 'sticker-love' THEN 'sticker-tender'
  WHEN 'sticker-angry' THEN 'sticker-laugh'
  WHEN 'sticker-tired' THEN 'sticker-magic'
  ELSE "rewardCode" END
WHERE "rewardCode" IN ('sticker-support','sticker-surprise','sticker-win','sticker-shy','sticker-love','sticker-angry','sticker-tired');
