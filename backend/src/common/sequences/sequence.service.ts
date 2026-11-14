import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class SequenceService {
  /**
   * Obtiene el siguiente número con bloqueo pesimista (SELECT FOR UPDATE).
   * DEBE ejecutarse dentro de una transacción serializable.
   */
  async nextNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    type: 'SALE' | 'PO',
    year: number = new Date().getFullYear(),
  ): Promise<{ number: number; formatted: string }> {
    // 1. Bloquear la fila con SELECT FOR UPDATE
    const rows = await tx.$queryRaw<
      Array<{ id: string; prefix: string | null; currentNumber: number }>
    >`
      SELECT id, prefix, "currentNumber"
      FROM "OrganizationSequence"
      WHERE "organizationId" = ${organizationId}
        AND type = ${type}
        AND year = ${year}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new Error(
        `Sequence not found for org=${organizationId}, type=${type}, year=${year}`,
      );
    }

    const seq = rows[0];

    // 2. Nunca entregar un número ya usado. El contador puede quedarse atrás
    // si las filas se crearon por fuera de esta secuencia (seed, importación,
    // backfill): en ese caso el máximo real manda y el contador se recupera.
    const maxExisting =
      type === 'SALE'
        ? ((
            await tx.sale.aggregate({
              where: { organizationId },
              _max: { saleNumber: true },
            })
          )._max.saleNumber ?? 0)
        : ((
            await tx.purchaseOrder.aggregate({
              where: { organizationId },
              _max: { orderNumber: true },
            })
          )._max.orderNumber ?? 0);

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
}
