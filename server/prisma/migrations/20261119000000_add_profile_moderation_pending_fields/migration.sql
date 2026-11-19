-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "pendingBio" TEXT,
ADD COLUMN     "pendingSocials" JSONB,
ADD COLUMN     "pendingAvatarUrl" TEXT;
