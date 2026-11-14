-- CreateEnum
CREATE TYPE "WhatsAppContactKind" AS ENUM ('CLIENT', 'INTERNAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WhatsAppConversationState" AS ENUM ('AUTOMATED', 'HUMAN', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactKind" "WhatsAppContactKind" NOT NULL DEFAULT 'CLIENT',
    "state" "WhatsAppConversationState" NOT NULL DEFAULT 'AUTOMATED',
    "customerId" TEXT,
    "firstInboundAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "source" TEXT NOT NULL,
    "body" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppInternalContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppInternalContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppConversation_organizationId_state_idx" ON "WhatsAppConversation"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_connectionId_contactPhone_key" ON "WhatsAppConversation"("connectionId", "contactPhone");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_conversationId_providerMessageId_key" ON "WhatsAppMessage"("conversationId", "providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_sentAt_idx" ON "WhatsAppMessage"("conversationId", "sentAt");

-- CreateIndex
CREATE INDEX "WhatsAppInternalContact_organizationId_idx" ON "WhatsAppInternalContact"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInternalContact_organizationId_phone_key" ON "WhatsAppInternalContact"("organizationId", "phone");

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInternalContact" ADD CONSTRAINT "WhatsAppInternalContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInternalContact" ADD CONSTRAINT "WhatsAppInternalContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
