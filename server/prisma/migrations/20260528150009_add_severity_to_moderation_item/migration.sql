-- AlterTable
ALTER TABLE "ModerationItem" ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'LOW';

-- CreateIndex
CREATE INDEX "ModerationItem_severity_idx" ON "ModerationItem"("severity");
