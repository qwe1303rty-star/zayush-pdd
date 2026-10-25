-- Аналитика посещаемости (ПДн, поведенческий профиль). Включается ACTIVITY_TRACKING.
CREATE TABLE "ActivityPing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityPing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityPing_at_idx" ON "ActivityPing"("at");
CREATE INDEX "ActivityPing_userId_at_idx" ON "ActivityPing"("userId", "at");
ALTER TABLE "ActivityPing" ADD CONSTRAINT "ActivityPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
