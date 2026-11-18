-- CreateEnum
CREATE TYPE "PurchaseOrderSendChannel" AS ENUM ('PDF', 'WHATSAPP');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "documentSnapshot" JSONB,
ADD COLUMN     "expectedDeliveryDate" DATE,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentVia" "PurchaseOrderSendChannel";
