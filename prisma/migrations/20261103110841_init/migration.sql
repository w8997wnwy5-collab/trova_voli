-- CreateTable
CREATE TABLE "ProviderCacheEntry" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "offers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCacheEntry_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ProviderCacheEntry_expiresAt_idx" ON "ProviderCacheEntry"("expiresAt");
