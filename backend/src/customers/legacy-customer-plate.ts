import { Prisma } from '@prisma/client';

/** Mirrors the compatibility field without deleting vehicle data on a clear. */
export async function synchronizeLegacyCustomerPlate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  plate: string | null | undefined,
) {
  if (typeof plate === 'string' && plate.trim()) {
    await tx.customerVehicle.upsert({
      where: { legacyCustomerId: customerId },
      create: {
        organizationId,
        customerId,
        legacyCustomerId: customerId,
        plate,
      },
      update: { plate },
    });
  } else {
    await tx.customerVehicle.updateMany({
      where: { organizationId, legacyCustomerId: customerId },
      data: { legacyCustomerId: null },
    });
  }
}
