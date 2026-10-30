-- CreateEnum
CREATE TYPE "WhatsAppChannel" AS ENUM ('COMMERCIAL', 'INTELLIGENCE');

-- CreateEnum
CREATE TYPE "WhatsAppSessionStatus" AS ENUM ('STOPPED', 'STARTING', 'SCAN_QR_CODE', 'PASSKEY_REQUIRED', 'PASSKEY_CONFIRMATION_REQUIRED', 'WORKING', 'FAILED');

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'WAHA',
    "sessionName" TEXT NOT NULL,
    "channel" "WhatsAppChannel" NOT NULL,
    "organizationId" TEXT,
    "status" "WhatsAppSessionStatus" NOT NULL DEFAULT 'STOPPED',
    "statusUpdatedAt" TIMESTAMP(3),
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppProcessedEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppConnection_channel_idx" ON "WhatsAppConnection"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_sessionName_key" ON "WhatsAppConnection"("sessionName");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_channel_organizationId_key" ON "WhatsAppConnection"("channel", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppProcessedEvent_connectionId_providerEventId_key" ON "WhatsAppProcessedEvent"("connectionId", "providerEventId");

-- CreateIndex
CREATE INDEX "WhatsAppProcessedEvent_receivedAt_idx" ON "WhatsAppProcessedEvent"("receivedAt");

-- One central channel only: PostgreSQL treats NULLs as distinct, so the
-- composite unique above cannot enforce a single organization-less session.
CREATE UNIQUE INDEX "WhatsAppConnection_central_intelligence_key" ON "WhatsAppConnection"("channel") WHERE "channel" = 'INTELLIGENCE';

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppProcessedEvent" ADD CONSTRAINT "WhatsAppProcessedEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
