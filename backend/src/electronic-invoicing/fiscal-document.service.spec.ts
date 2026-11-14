import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FiscalDocumentStatus } from '@prisma/client';
import {
  FISCAL_DOCUMENT_TRANSITIONS,
  FiscalDocumentService,
  voidSaleFiscalDocument,
} from './fiscal-document.service';

/**
 * T4c: the state machine is the only thing allowed to move a fiscal document.
 * The legal edges are PENDING→SENT, SENT→ACCEPTED, SENT→REJECTED and
 * {PENDING,SENT}→VOIDED; everything else is a 409 and must leave the row
 * untouched. Every read and write is scoped by organization, and a document
 * from another organization is a 404, never a 403, so its existence does not
 * leak.
 */
describe('FiscalDocumentService', () => {
  let prismaMock: {
    fiscalDocument: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: FiscalDocumentService;

  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'fiscal-1',
    organizationId: 'org-1',
    saleId: 'sale-1',
    status: FiscalDocumentStatus.PENDING,
    cufe: null,
    invoiceNumber: null,
    issuedAt: new Date('2026-11-04T15:20:31.000Z'),
    sentAt: null,
    resolvedAt: null,
    rejectionReason: null,
    snapshot: { version: 1, saleId: 'sale-1' },
    createdAt: new Date('2026-11-04T15:20:31.000Z'),
    updatedAt: new Date('2026-11-04T15:20:31.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      fiscalDocument: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new FiscalDocumentService(prismaMock as never);
  });

  /** Prime the read of the document and the reload after a transition. */
  const prime = (
    current: Record<string, unknown>,
    next?: Record<string, unknown>,
  ) => {
    prismaMock.fiscalDocument.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(next ?? { ...current, status: current.status });
  };

  const updatePayload = () =>
    prismaMock.fiscalDocument.updateMany.mock.calls[0][0];

  describe('the transition table', () => {
    it('allows exactly the five legal edges and nothing else', () => {
      expect(FISCAL_DOCUMENT_TRANSITIONS).toEqual({
        PENDING: ['SENT', 'VOIDED'],
        SENT: ['ACCEPTED', 'REJECTED', 'VOIDED'],
        ACCEPTED: [],
        REJECTED: [],
        VOIDED: [],
      });
    });

    it('freezes the table so a caller cannot widen it at runtime', () => {
      expect(Object.isFrozen(FISCAL_DOCUMENT_TRANSITIONS)).toBe(true);
      expect(Object.isFrozen(FISCAL_DOCUMENT_TRANSITIONS.PENDING)).toBe(true);
      expect(Object.isFrozen(FISCAL_DOCUMENT_TRANSITIONS.ACCEPTED)).toBe(true);
    });
  });

  describe('organization scoping', () => {
    it('reads a document by sale inside the organization', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(stored());

      const document = await service.findBySaleId('sale-1', 'org-1');

      expect(document.id).toBe('fiscal-1');
      expect(prismaMock.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: { saleId: 'sale-1', organizationId: 'org-1' },
      });
    });

    it('answers 404 when the document belongs to another organization', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.findBySaleId('sale-1', 'org-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: { saleId: 'sale-1', organizationId: 'org-2' },
      });
    });

    it('answers 404 when reading another organization document by id', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(null);

      await expect(service.findOne('fiscal-1', 'org-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'fiscal-1', organizationId: 'org-2' },
      });
    });

    it('does not mutate anything when the transition target is another organization', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.transition('fiscal-1', 'org-2', FiscalDocumentStatus.SENT),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('legal transitions', () => {
    it('PENDING → SENT records the send instant and leaves resolvedAt null', async () => {
      const current = stored();
      prime(current, { ...current, status: FiscalDocumentStatus.SENT });

      const document = await service.transition(
        'fiscal-1',
        'org-1',
        FiscalDocumentStatus.SENT,
      );

      expect(document.status).toBe(FiscalDocumentStatus.SENT);
      expect(updatePayload()).toEqual({
        where: {
          id: 'fiscal-1',
          organizationId: 'org-1',
          status: FiscalDocumentStatus.PENDING,
        },
        data: {
          status: FiscalDocumentStatus.SENT,
          sentAt: expect.any(Date),
        },
      });
      expect(updatePayload().data).not.toHaveProperty('resolvedAt');
    });

    it('SENT → ACCEPTED records resolvedAt', async () => {
      const current = stored({ status: FiscalDocumentStatus.SENT });
      prime(current, { ...current, status: FiscalDocumentStatus.ACCEPTED });

      await service.transition(
        'fiscal-1',
        'org-1',
        FiscalDocumentStatus.ACCEPTED,
      );

      expect(updatePayload().data).toEqual({
        status: FiscalDocumentStatus.ACCEPTED,
        resolvedAt: expect.any(Date),
      });
    });

    it('SENT → REJECTED records resolvedAt and the trimmed rejection reason', async () => {
      const current = stored({ status: FiscalDocumentStatus.SENT });
      prime(current, { ...current, status: FiscalDocumentStatus.REJECTED });

      await service.transition(
        'fiscal-1',
        'org-1',
        FiscalDocumentStatus.REJECTED,
        { rejectionReason: '  FAB02 inválido  ' },
      );

      expect(updatePayload().data).toEqual({
        status: FiscalDocumentStatus.REJECTED,
        resolvedAt: expect.any(Date),
        rejectionReason: 'FAB02 inválido',
      });
    });

    it('PENDING → VOIDED records resolvedAt', async () => {
      const current = stored();
      prime(current, { ...current, status: FiscalDocumentStatus.VOIDED });

      await service.transition(
        'fiscal-1',
        'org-1',
        FiscalDocumentStatus.VOIDED,
      );

      expect(updatePayload().data).toEqual({
        status: FiscalDocumentStatus.VOIDED,
        resolvedAt: expect.any(Date),
      });
    });

    it('SENT → VOIDED records resolvedAt', async () => {
      const current = stored({ status: FiscalDocumentStatus.SENT });
      prime(current, { ...current, status: FiscalDocumentStatus.VOIDED });

      await service.transition(
        'fiscal-1',
        'org-1',
        FiscalDocumentStatus.VOIDED,
      );

      expect(updatePayload().data).toEqual({
        status: FiscalDocumentStatus.VOIDED,
        resolvedAt: expect.any(Date),
      });
    });

    it('never accepts issuance facts a transport has not obtained', async () => {
      const current = stored();
      prime(current, { ...current, status: FiscalDocumentStatus.SENT });

      // No transport exists yet (spec S6), so a caller cannot mint an invoice
      // number or a CUFE through a transition.
      await expect(
        service.transition('fiscal-1', 'org-1', FiscalDocumentStatus.SENT, {
          invoiceNumber: 'SETP990000001',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('returns the reloaded document after the transition', async () => {
      const current = stored();
      prime(current, { ...current, status: FiscalDocumentStatus.SENT });

      const document = await service.transition(
        'fiscal-1',
        'org-1',
        FiscalDocumentStatus.SENT,
      );

      expect(prismaMock.fiscalDocument.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.fiscalDocument.findFirst).toHaveBeenLastCalledWith({
        where: { id: 'fiscal-1', organizationId: 'org-1' },
      });
      expect(document.status).toBe(FiscalDocumentStatus.SENT);
    });
  });

  describe('illegal transitions', () => {
    const illegal: Array<[FiscalDocumentStatus, FiscalDocumentStatus]> = [
      [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.PENDING],
      [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.ACCEPTED],
      [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.REJECTED],
      [FiscalDocumentStatus.SENT, FiscalDocumentStatus.PENDING],
      [FiscalDocumentStatus.SENT, FiscalDocumentStatus.SENT],
      [FiscalDocumentStatus.ACCEPTED, FiscalDocumentStatus.SENT],
      [FiscalDocumentStatus.ACCEPTED, FiscalDocumentStatus.ACCEPTED],
      [FiscalDocumentStatus.ACCEPTED, FiscalDocumentStatus.REJECTED],
      [FiscalDocumentStatus.ACCEPTED, FiscalDocumentStatus.VOIDED],
      [FiscalDocumentStatus.REJECTED, FiscalDocumentStatus.SENT],
      [FiscalDocumentStatus.REJECTED, FiscalDocumentStatus.ACCEPTED],
      [FiscalDocumentStatus.REJECTED, FiscalDocumentStatus.VOIDED],
      [FiscalDocumentStatus.VOIDED, FiscalDocumentStatus.SENT],
      [FiscalDocumentStatus.VOIDED, FiscalDocumentStatus.ACCEPTED],
      [FiscalDocumentStatus.VOIDED, FiscalDocumentStatus.REJECTED],
    ];

    it.each(illegal)(
      '%s → %s answers 409 and leaves the row untouched',
      async (from, to) => {
        prismaMock.fiscalDocument.findFirst.mockResolvedValue(
          stored({ status: from }),
        );

        await expect(
          service.transition('fiscal-1', 'org-1', to, {
            rejectionReason: 'porque sí',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
      },
    );

    it('answers 409 when the guarded update matches no row', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(stored());
      prismaMock.fiscalDocument.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.transition('fiscal-1', 'org-1', FiscalDocumentStatus.SENT),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('transition payload discipline', () => {
    it('refuses to reject without a reason and writes nothing', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(
        stored({ status: FiscalDocumentStatus.SENT }),
      );

      await expect(
        service.transition('fiscal-1', 'org-1', FiscalDocumentStatus.REJECTED),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a blank rejection reason', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(
        stored({ status: FiscalDocumentStatus.SENT }),
      );

      await expect(
        service.transition('fiscal-1', 'org-1', FiscalDocumentStatus.REJECTED, {
          rejectionReason: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to record a rejection reason on any other target', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(stored());

      await expect(
        service.transition('fiscal-1', 'org-1', FiscalDocumentStatus.SENT, {
          rejectionReason: 'no aplica',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('refuses an invoice number or a CUFE without writing anything', async () => {
      prismaMock.fiscalDocument.findFirst.mockResolvedValue(stored());

      await expect(
        service.transition('fiscal-1', 'org-1', FiscalDocumentStatus.SENT, {
          cufe: 'a'.repeat(96),
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('never writes the snapshot on any legal transition', async () => {
      const legal: Array<[FiscalDocumentStatus, FiscalDocumentStatus]> = [
        [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.SENT],
        [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.VOIDED],
        [FiscalDocumentStatus.SENT, FiscalDocumentStatus.ACCEPTED],
        [FiscalDocumentStatus.SENT, FiscalDocumentStatus.REJECTED],
        [FiscalDocumentStatus.SENT, FiscalDocumentStatus.VOIDED],
      ];

      for (const [from, to] of legal) {
        prismaMock.fiscalDocument.findFirst.mockReset();
        prismaMock.fiscalDocument.updateMany.mockClear();
        prismaMock.fiscalDocument.updateMany.mockResolvedValue({ count: 1 });
        const current = stored({ status: from });
        prime(current, { ...current, status: to });

        await service.transition('fiscal-1', 'org-1', to, {
          rejectionReason:
            to === FiscalDocumentStatus.REJECTED ? 'rechazada' : undefined,
        });

        expect(updatePayload().data).not.toHaveProperty('snapshot');
        expect(updatePayload().data).not.toHaveProperty('issuedAt');
        expect(updatePayload().data).not.toHaveProperty('saleId');
        expect(updatePayload().data).not.toHaveProperty('organizationId');
      }
    });
  });
});

/**
 * Cancelling a sale is the one write that moves a fiscal document outside the
 * service: it happens inside the sale's own transaction. It obeys the same
 * table, and a sale whose document is already resolved is refused instead of
 * leaving a resolved document describing a cancelled sale (spec S8; a credit
 * note is out of this task).
 */
describe('voidSaleFiscalDocument', () => {
  const buildTx = () => ({
    fiscalDocument: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  });

  const sale = { saleId: 'sale-1', organizationId: 'org-1' };

  it('does nothing when the sale has no fiscal document', async () => {
    const tx = buildTx();
    tx.fiscalDocument.findFirst.mockResolvedValue(null);

    await expect(
      voidSaleFiscalDocument(tx as never, sale),
    ).resolves.toBeUndefined();
    expect(tx.fiscalDocument.updateMany).not.toHaveBeenCalled();
  });

  it.each([FiscalDocumentStatus.PENDING, FiscalDocumentStatus.SENT])(
    'voids a %s document with an organization-scoped, status-guarded update',
    async (status) => {
      const tx = buildTx();
      tx.fiscalDocument.findFirst.mockResolvedValue({ id: 'fiscal-1', status });

      await voidSaleFiscalDocument(tx as never, sale);

      expect(tx.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: { saleId: 'sale-1', organizationId: 'org-1' },
        select: { id: true, status: true },
      });
      expect(tx.fiscalDocument.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'fiscal-1',
          organizationId: 'org-1',
          status,
        },
        data: {
          status: FiscalDocumentStatus.VOIDED,
          resolvedAt: expect.any(Date),
        },
      });
    },
  );

  it.each([FiscalDocumentStatus.ACCEPTED, FiscalDocumentStatus.REJECTED])(
    'refuses to cancel a sale whose document is already %s',
    async (status) => {
      const tx = buildTx();
      tx.fiscalDocument.findFirst.mockResolvedValue({ id: 'fiscal-1', status });

      await expect(
        voidSaleFiscalDocument(tx as never, sale),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.fiscalDocument.updateMany).not.toHaveBeenCalled();
    },
  );

  it('reads only its own organization, so another tenant document is invisible', async () => {
    const tx = buildTx();
    tx.fiscalDocument.findFirst.mockResolvedValue(null);

    await voidSaleFiscalDocument(tx as never, {
      saleId: 'sale-1',
      organizationId: 'org-2',
    });

    expect(tx.fiscalDocument.findFirst).toHaveBeenCalledWith({
      where: { saleId: 'sale-1', organizationId: 'org-2' },
      select: { id: true, status: true },
    });
    expect(tx.fiscalDocument.updateMany).not.toHaveBeenCalled();
  });

  it('answers 409 when the guarded update matches no row', async () => {
    const tx = buildTx();
    tx.fiscalDocument.findFirst.mockResolvedValue({
      id: 'fiscal-1',
      status: FiscalDocumentStatus.PENDING,
    });
    tx.fiscalDocument.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      voidSaleFiscalDocument(tx as never, sale),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
