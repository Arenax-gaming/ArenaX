-- API key permission scopes and rotation overlap (#1420)
ALTER TABLE "ApiKey" ADD COLUMN "keyPrefix" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ApiKey" ADD COLUMN "graceExpiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "rotatedFromId" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
