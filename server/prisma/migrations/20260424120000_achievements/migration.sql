-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('COMBAT', 'SOCIAL', 'PROGRESSION', 'SEASONAL');

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "AchievementCategory" NOT NULL,
    "targetValue" INTEGER NOT NULL DEFAULT 1,
    "eventTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rewards" JSONB NOT NULL DEFAULT '{}',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "rewardClaimedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "shareSlug" TEXT NOT NULL,
    "caption" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE INDEX "Achievement_category_idx" ON "Achievement"("category");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAchievement_userId_achievementId_key" ON "PlayerAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "PlayerAchievement_userId_idx" ON "PlayerAchievement"("userId");

-- CreateIndex
CREATE INDEX "PlayerAchievement_achievementId_idx" ON "PlayerAchievement"("achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementShare_shareSlug_key" ON "AchievementShare"("shareSlug");

-- CreateIndex
CREATE INDEX "AchievementShare_userId_idx" ON "AchievementShare"("userId");

-- CreateIndex
CREATE INDEX "AchievementShare_achievementId_idx" ON "AchievementShare"("achievementId");

-- CreateIndex
CREATE INDEX "AchievementNotification_userId_readAt_idx" ON "AchievementNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AchievementNotification_achievementId_idx" ON "AchievementNotification"("achievementId");

-- AddForeignKey
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementShare" ADD CONSTRAINT "AchievementShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementShare" ADD CONSTRAINT "AchievementShare_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementNotification" ADD CONSTRAINT "AchievementNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementNotification" ADD CONSTRAINT "AchievementNotification_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
