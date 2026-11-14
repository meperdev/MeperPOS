import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Translate expired interactive transactions without hiding other failures. */
export function throwPayrollTransactionError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2028'
  ) {
    throw new ServiceUnavailableException(
      'No se pudo confirmar la operación. Verifique su estado antes de reintentar',
    );
  }
  throw error;
}
