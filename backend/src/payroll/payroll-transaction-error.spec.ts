import { Prisma } from '@prisma/client';
import { throwPayrollTransactionError } from './payroll-transaction-error';

describe('throwPayrollTransactionError', () => {
  it.each(['P2002', 'P2010', 'P2025', 'P2034'])(
    'preserves Prisma error %s by identity',
    (code) => {
      const error = new Prisma.PrismaClientKnownRequestError('database error', {
        code,
        clientVersion: 'test',
      });
      expect(() => throwPayrollTransactionError(error)).toThrow(error);
      try {
        throwPayrollTransactionError(error);
      } catch (caught) {
        expect(caught).toBe(error);
      }
    },
  );
});
