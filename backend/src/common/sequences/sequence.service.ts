import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type SequenceType = 'SALE' | 'PO' | 'TRANSFER';

interface SequenceRow {
  id: string;
  prefix: string | null;
  currentNumber: number;
}

@Injectable()
export class SequenceService {
  /**
   * Obtiene el siguiente número con bloqueo pesimista (SELECT FOR UPDATE).
   * DEBE ejecutarse dentro de una transacción serializable.
   *
   * A SALE or PO counter must already exist. The TRANSFER counter is opened on
   * first use instead, because an organization can be created without ever
   * knowing whether it will move stock between its sites.
   */
  async nextNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    type: SequenceType,
    year: number = new Date().getFullYear(),
  ): Promise<{ number: number; formatted: string }> {
    // 1. Bloquear la fila con SELECT FOR UPDATE
    const rows = await tx.$queryRaw<SequenceRow[]>`
      SELECT id, prefix, "currentNumber"
      FROM "OrganizationSequence"
      WHERE "organizationId" = ${organizationId}
        AND type = ${type}
        AND year = ${year}
      FOR UPDATE
    `;

    let seq = rows[0];
    if (!seq) {
      if (type !== 'TRANSFER') {
        throw new Error(
          `Sequence not found for org=${organizationId}, type=${type}, year=${year}`,
        );
      }
      // A concurrent first transfer may win the insert; the loser re-reads the
      // row the winner committed instead of failing the whole dispatch.
      await tx.$executeRaw`
        INSERT INTO "OrganizationSequence" ("id", "organizationId", "type", "prefix", "currentNumber", "year")
        VALUES (gen_random_uuid()::text, ${organizationId}, ${type}, NULL, 0, ${year})
        ON CONFLICT ("organizationId", "type", "year") DO NOTHING
      `;
      const opened = await tx.$queryRaw<SequenceRow[]>`
        SELECT id, prefix, "currentNumber"
        FROM "OrganizationSequence"
        WHERE "organizationId" = ${organizationId}
          AND type = ${type}
          AND year = ${year}
        FOR UPDATE
      `;
      seq = opened[0];
      if (!seq) {
        throw new Error(
          `Sequence not found for org=${organizationId}, type=${type}, year=${year}`,
        );
      }
    }

    // 2. Nunca entregar un número ya usado. El contador puede quedarse atrás
    // si las filas se crearon por fuera de esta secuencia (seed, importación,
    // backfill): en ese caso el máximo real manda y el contador se recupera.
    const maxExisting = await this.maxStoredNumber(tx, organizationId, type);

    // 3. Incrementar atómicamente desde el mayor de los dos
    const updated = await tx.organizationSequence.update({
      where: { id: seq.id },
      data: { currentNumber: Math.max(seq.currentNumber, maxExisting) + 1 },
    });

    const formatted = updated.prefix
      ? `${updated.prefix}-${updated.currentNumber}`
      : String(updated.currentNumber);

    return { number: updated.currentNumber, formatted };
  }

  /** Highest number already stored for this document type, never a cached count. */
  private async maxStoredNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    type: SequenceType,
  ): Promise<number> {
    switch (type) {
      case 'SALE':
        return (
          (
            await tx.sale.aggregate({
              where: { organizationId },
              _max: { saleNumber: true },
            })
          )._max.saleNumber ?? 0
        );
      case 'PO':
        return (
          (
            await tx.purchaseOrder.aggregate({
              where: { organizationId },
              _max: { orderNumber: true },
            })
          )._max.orderNumber ?? 0
        );
      case 'TRANSFER':
        return (
          (
            await tx.stockTransfer.aggregate({
              where: { organizationId },
              _max: { number: true },
            })
          )._max.number ?? 0
        );
    }
  }
}
