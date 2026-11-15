-- CreateEnum
CREATE TYPE "ProductStockAlertEventKind" AS ENUM ('OPENED', 'RESOLVED', 'NOTIFIED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ProductStockAlertEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "episode" INTEGER NOT NULL,
    "kind" "ProductStockAlertEventKind" NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStockAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductStockAlertEvent_organizationId_createdAt_idx" ON "ProductStockAlertEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductStockAlertEvent_organizationId_kind_idx" ON "ProductStockAlertEvent"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "ProductStockAlertEvent_productId_episode_idx" ON "ProductStockAlertEvent"("productId", "episode");

-- AddForeignKey
ALTER TABLE "ProductStockAlertEvent" ADD CONSTRAINT "ProductStockAlertEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockAlertEvent" ADD CONSTRAINT "ProductStockAlertEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

