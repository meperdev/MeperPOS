-- CreateEnum
CREATE TYPE "ProductStockAlertState" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ProductStockAlertNotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ProductStockAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "state" "ProductStockAlertState" NOT NULL DEFAULT 'OPEN',
    "episode" INTEGER NOT NULL DEFAULT 1,
    "stockAtOpen" INTEGER NOT NULL,
    "minStockAtOpen" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notificationStatus" "ProductStockAlertNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "notificationFailure" TEXT,
    "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductStockAlert_productId_key" ON "ProductStockAlert"("productId");

-- CreateIndex
CREATE INDEX "ProductStockAlert_organizationId_state_idx" ON "ProductStockAlert"("organizationId", "state");

-- CreateIndex
CREATE INDEX "ProductStockAlert_organizationId_notificationStatus_idx" ON "ProductStockAlert"("organizationId", "notificationStatus");

-- AddForeignKey
ALTER TABLE "ProductStockAlert" ADD CONSTRAINT "ProductStockAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockAlert" ADD CONSTRAINT "ProductStockAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

