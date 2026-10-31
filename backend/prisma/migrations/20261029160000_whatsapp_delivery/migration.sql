-- CreateEnum
CREATE TYPE "WhatsAppDeliveryKind" AS ENUM ('SCHEDULED', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "WhatsAppDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "WhatsAppDelivery" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "WhatsAppDeliveryKind" NOT NULL,
    "reportDate" DATE NOT NULL,
    "status" "WhatsAppDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_connectionId_reportDate_idx" ON "WhatsAppDelivery"("connectionId", "reportDate");

-- CreateIndex
-- One scheduled report per connection per calendar day. The predicate keeps
-- ON_DEMAND rows out of the constraint, because an administrator may legitimately
-- ask for the report more than once in the same day.
CREATE UNIQUE INDEX "WhatsAppDelivery_scheduled_once_per_day_key" ON "WhatsAppDelivery"("connectionId", "kind", "reportDate") WHERE "kind" = 'SCHEDULED';

-- AddForeignKey
ALTER TABLE "WhatsAppDelivery" ADD CONSTRAINT "WhatsAppDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
