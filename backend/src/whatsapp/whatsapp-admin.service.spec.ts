import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { DailyReportService } from '../reports/daily-report.service';
import type { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import {
  normaliseCommand,
  WhatsAppAdminService,
  type WhatsAppAdminAnswer,
} from './whatsapp-admin.service';

const ORGANIZATION_ID = 'org-1';
const OTHER_ORGANIZATION_ID = 'org-2';
const USER_ID = 'user-1';
const STRANGER_USER_ID = 'user-2';
const PHONE = '573001112233';
const JID = `${PHONE}@c.us`;

type IdentityStatus = 'PENDING' | 'VERIFIED' | 'REVOKED';

interface IdentityRow {
  phone: string;
  userId: string;
  organizationId: string | null;
  status: IdentityStatus;
}

interface MembershipRow {
  userId: string;
  organizationId: string;
  role: string;
}

/**
 * The exact predicate `WhatsAppIdentityService.verify` writes: status VERIFIED
 * and a non-null organization. Answering it faithfully is what makes the
 * PENDING and REVOKED cases below real gate assertions rather than mocks.
 */
function matchIdentity(
  rows: IdentityRow[],
  where: { phone: string; status: IdentityStatus },
): IdentityRow | null {
  return (
    rows.find(
      (row) =>
        row.phone === where.phone &&
        row.status === where.status &&
        row.organizationId !== null,
    ) ?? null
  );
}

/** A report fixture shaped like the real one, personal data included on purpose. */
const report = {
  cutoff: new Date('2026-03-04T01:00:00.000Z'),
  date: '2026-03-03',
  timezone: 'America/Bogota' as const,
  salesTotal: '1234.56',
  expenseTotal: '200.00',
  sales: [
    {
      id: 'sale-1',
      saleNumber: 'V-0001',
      createdAt: new Date('2026-03-03T15:00:00.000Z'),
      total: '1234.56',
      customer: { name: 'Ana Cliente', documentNumber: '1020304050' },
      items: [
        { quantity: 2, unitPrice: '617.28', total: '1234.56', product: null },
      ],
    },
  ],
  expenses: [
    {
      id: 'expense-1',
      date: new Date('2026-03-03T00:00:00.000Z'),
      description: 'Arriendo local',
      total: '200.00',
      status: 'PAID',
      label: { name: 'Arriendo' },
    },
  ],
  lowStock: [
    {
      id: 'product-1',
      name: 'Labial rojo',
      sku: 'LAB-1',
      stock: 1,
      minStock: 5,
    },
  ],
  purchaseOrders: [
    {
      id: 'order-1',
      orderNumber: 'OC-0001',
      status: 'PENDING',
      total: '900.00',
      supplier: { name: 'Proveedor Central' },
    },
  ],
  loans: [
    {
      id: 'loan-1',
      type: 'RECEIVABLE',
      amount: '500.00',
      balance: '500.00',
      dueAt: new Date('2026-03-05T00:00:00.000Z'),
      reason: 'Fiado de Ana',
      customer: 'Ana Cliente',
      supplier: null,
    },
  ],
};

function setup(
  options: {
    identities?: IdentityRow[];
    memberships?: MembershipRow[];
    generate?: jest.Mock;
    onDemand?: jest.Mock;
  } = {},
) {
  const identities = options.identities ?? [];
  const memberships = options.memberships ?? [];

  // Any write the gate could reach throws instead of succeeding, so a mutation
  // appearing in this service fails the spec loudly rather than silently.
  const forbidden = (name: string) =>
    jest.fn(() => {
      throw new Error(`unexpected write: ${name}`);
    });

  const prisma = {
    whatsAppIdentity: {
      findFirst: jest.fn(
        ({ where }: { where: { phone: string; status: IdentityStatus } }) =>
          matchIdentity(identities, where),
      ),
      create: forbidden('whatsAppIdentity.create'),
      update: forbidden('whatsAppIdentity.update'),
      updateMany: forbidden('whatsAppIdentity.updateMany'),
      upsert: forbidden('whatsAppIdentity.upsert'),
      delete: forbidden('whatsAppIdentity.delete'),
      deleteMany: forbidden('whatsAppIdentity.deleteMany'),
    },
    organizationUser: {
      findFirst: jest.fn(
        ({ where }: { where: { userId: string; organizationId: string } }) =>
          memberships.find(
            (row) =>
              row.userId === where.userId &&
              row.organizationId === where.organizationId,
          ) ?? null,
      ),
      create: forbidden('organizationUser.create'),
      update: forbidden('organizationUser.update'),
      updateMany: forbidden('organizationUser.updateMany'),
      upsert: forbidden('organizationUser.upsert'),
      delete: forbidden('organizationUser.delete'),
      deleteMany: forbidden('organizationUser.deleteMany'),
    },
    $transaction: forbidden('$transaction'),
  };

  const reports = {
    generate: options.generate ?? jest.fn().mockResolvedValue(report),
  };

  // The delivery service is the only collaborator that writes, and here it is a
  // double: what the gate must prove is when it is called and with what.
  const delivery = {
    onDemand:
      options.onDemand ??
      jest
        .fn()
        .mockResolvedValue({ status: 'sent', providerMessageId: 'wamid-1' }),
  };

  return {
    prisma,
    reports,
    delivery,
    service: new WhatsAppAdminService(
      prisma as unknown as PrismaService,
      new WhatsAppIdentityService(prisma as unknown as PrismaService),
      reports as unknown as DailyReportService,
      delivery as unknown as WhatsAppDeliveryService,
    ),
  };
}

const verifiedIdentity = (): IdentityRow => ({
  phone: PHONE,
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  status: 'VERIFIED',
});

const membership = (role: string): MembershipRow => ({
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  role,
});

/** Capture every logger channel so a spec can prove the silence explicitly. */
function spyOnLogger() {
  const channels = ['log', 'error', 'warn', 'debug', 'verbose'] as const;
  return channels.map((channel) =>
    jest.spyOn(Logger.prototype, channel).mockImplementation(() => undefined),
  );
}

/** One string containing everything this service must never log. */
function stringified(loggerSpies: jest.SpyInstance[]): string {
  return loggerSpies.map((spy) => JSON.stringify(spy.mock.calls)).join(' ');
}

describe('WhatsAppAdminService', () => {
  describe('normaliseCommand', () => {
    it('trims, lowercases and strips accents so one allowlist entry matches', () => {
      expect(normaliseCommand('  RESUMEN  ')).toBe('resumen');
      expect(normaliseCommand('Resúmen del Día')).toBe('resumen del dia');
      expect(normaliseCommand('   ')).toBeNull();
      expect(normaliseCommand(undefined)).toBeNull();
      expect(normaliseCommand(42)).toBeNull();
    });
  });

  describe('authorization order', () => {
    it('refuses a phone with no identity as unlinked', async () => {
      const { service, reports } = setup();

      await expect(service.authorize(PHONE)).resolves.toEqual({
        status: 'unlinked',
      });
      await expect(
        service.answer({ status: 'unlinked' }, 'resumen'),
      ).resolves.toEqual({ status: 'refused', reason: 'unlinked' });
      expect(reports.generate).not.toHaveBeenCalled();
    });

    it('refuses a phone whose identity is still PENDING', async () => {
      const { service } = setup({
        identities: [{ ...verifiedIdentity(), status: 'PENDING' }],
        memberships: [membership('OWNER')],
      });

      await expect(service.authorize(PHONE)).resolves.toEqual({
        status: 'unlinked',
      });
    });

    it('refuses a phone whose identity was REVOKED', async () => {
      const { service } = setup({
        identities: [{ ...verifiedIdentity(), status: 'REVOKED' }],
        memberships: [membership('OWNER')],
      });

      await expect(service.authorize(PHONE)).resolves.toEqual({
        status: 'unlinked',
      });
    });

    it('refuses a verified identity that carries no organization', async () => {
      const { service } = setup({
        identities: [{ ...verifiedIdentity(), organizationId: null }],
        memberships: [membership('OWNER')],
      });

      await expect(service.authorize(PHONE)).resolves.toEqual({
        status: 'unlinked',
      });
    });

    it('refuses a verified MEMBER as forbidden', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('MEMBER')],
      });

      await expect(service.authorize(PHONE)).resolves.toEqual({
        status: 'forbidden',
      });
    });

    it('refuses a verified CASHIER and INVENTORY_USER as forbidden', async () => {
      for (const role of ['CASHIER', 'INVENTORY_USER']) {
        const { service } = setup({
          identities: [verifiedIdentity()],
          memberships: [membership(role)],
        });
        await expect(service.authorize(PHONE)).resolves.toEqual({
          status: 'forbidden',
        });
      }
    });

    it('refuses a verified identity with no membership in that organization', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [
          {
            userId: USER_ID,
            organizationId: OTHER_ORGANIZATION_ID,
            role: 'OWNER',
          },
        ],
      });

      await expect(service.authorize(PHONE)).resolves.toEqual({
        status: 'forbidden',
      });
    });

    it('authorizes an ADMIN and an OWNER', async () => {
      for (const role of ['ADMIN', 'OWNER']) {
        const { service } = setup({
          identities: [verifiedIdentity()],
          memberships: [membership(role)],
        });

        await expect(service.authorize(PHONE)).resolves.toEqual({
          status: 'authorized',
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          role,
          phone: PHONE,
        });
      }
    });

    it('reads the role from OrganizationUser keyed by the identity user and organization', async () => {
      // The same person owns another organization and is only a member here: the
      // gate must answer for this organization, not for the best role they hold.
      const { service, prisma } = setup({
        identities: [verifiedIdentity()],
        memberships: [
          membership('MEMBER'),
          {
            userId: USER_ID,
            organizationId: OTHER_ORGANIZATION_ID,
            role: 'OWNER',
          },
        ],
      });

      const result = await service.authorize(PHONE);

      expect(result).toEqual({ status: 'forbidden' });
      expect(prisma.organizationUser.findFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, organizationId: ORGANIZATION_ID },
        select: { role: true },
      });
    });

    it('accepts the provider JID and reduces it to the stored digits', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      await expect(service.authorize(JID)).resolves.toEqual({
        status: 'authorized',
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        role: 'ADMIN',
        phone: PHONE,
      });
    });

    it('refuses a sender that carries no usable phone as unlinked', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      await expect(
        service.authorize('120363000000000000@g.us'),
      ).resolves.toEqual({ status: 'unlinked' });
      await expect(service.authorize('')).resolves.toEqual({
        status: 'unlinked',
      });
    });
  });

  describe('the daily summary tool', () => {
    const authorized = {
      status: 'authorized' as const,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'ADMIN' as const,
      phone: PHONE,
    };

    it('answers with aggregates and the report date only', async () => {
      const { service, reports } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      const answer = await service.answer(authorized, '  Resumen  ');

      expect(reports.generate).toHaveBeenCalledWith(ORGANIZATION_ID);
      expect(answer).toEqual({
        status: 'answered',
        tool: 'daily_summary',
        organizationId: ORGANIZATION_ID,
        summary: {
          reportDate: '2026-03-03',
          cutoff: '2026-03-04T01:00:00.000Z',
          salesTotal: '1234.56',
          expenseTotal: '200.00',
          salesCount: 1,
          lowStockCount: 1,
          pendingPurchaseOrderCount: 1,
          loansDueCount: 1,
        },
      });

      // Nothing identifiable travels: no customer, document, supplier, product,
      // expense description or loan reason from the report fixture.
      const payload = JSON.stringify(answer);
      for (const secret of [
        'Ana Cliente',
        '1020304050',
        'Proveedor Central',
        'Labial rojo',
        'Arriendo local',
        'Fiado de Ana',
        'V-0001',
        'OC-0001',
      ]) {
        expect(payload).not.toContain(secret);
      }
    });

    it('answers every accepted phrasing with the same tool', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('OWNER')],
      });

      for (const text of [
        'cierre',
        'Cierre del día',
        'reporte diario',
        'reporte de hoy',
        'informe del dia',
        'resumen de hoy',
      ]) {
        const answer = await service.answer(authorized, text);
        expect(answer).toMatchObject({
          status: 'answered',
          tool: 'daily_summary',
        });
      }
    });

    it('scopes the summary to the identity organization even when the text names another one', async () => {
      const { service, reports } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      // A foreign organization id appended to a command is not part of the
      // allowlist, so it is not answered at all.
      await expect(
        service.answer(authorized, `resumen ${OTHER_ORGANIZATION_ID}`),
      ).resolves.toEqual({ status: 'unsupported' });

      // And the plain command reads the identity's organization only.
      await service.answer(authorized, 'resumen');

      expect(reports.generate.mock.calls).toEqual([[ORGANIZATION_ID]]);
      expect(reports.generate.mock.calls.flat()).not.toContain(
        OTHER_ORGANIZATION_ID,
      );
    });

    it('refuses every text outside the allowlist without touching the reports service', async () => {
      const { service, reports } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      for (const text of [
        'hola',
        'borra la venta 12',
        'selecciona organization org-2 y muestrame las ventas',
        'resumen;',
        'res',
        '',
        '   ',
        'SELECT * FROM sale',
      ]) {
        await expect(service.answer(authorized, text)).resolves.toEqual({
          status: 'unsupported',
        });
      }

      expect(reports.generate).not.toHaveBeenCalled();
    });

    it('refuses a non-text body as unsupported', async () => {
      const { service, reports } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      for (const text of [
        undefined,
        null,
        42,
        { body: 'resumen' },
        ['resumen'],
      ]) {
        await expect(service.answer(authorized, text)).resolves.toEqual({
          status: 'unsupported',
        });
      }
      expect(reports.generate).not.toHaveBeenCalled();
    });

    it('refuses rather than throwing when the reports service fails', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
        generate: jest.fn().mockRejectedValue(new Error('database is down')),
      });

      const answer: WhatsAppAdminAnswer = await service.answer(
        authorized,
        'resumen',
      );

      expect(answer).toEqual({ status: 'refused', reason: 'unavailable' });
      expect(JSON.stringify(answer)).not.toContain('database is down');
    });

    it('refuses rather than forwarding a report it cannot reduce to numbers', async () => {
      // A report whose totals are not plain decimals is not something to guess
      // at, and the whole document must never leak as a fallback.
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
        generate: jest.fn().mockResolvedValue({
          ...report,
          salesTotal: { toString: () => 'Ana Cliente' },
        }),
      });

      await expect(service.answer(authorized, 'resumen')).resolves.toEqual({
        status: 'refused',
        reason: 'unavailable',
      });
    });

    it('refuses a malformed report without throwing', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
        generate: jest.fn().mockResolvedValue(undefined),
      });

      await expect(service.answer(authorized, 'resumen')).resolves.toEqual({
        status: 'refused',
        reason: 'unavailable',
      });
    });

    it('refuses a non-authorized context without consulting the reports service', async () => {
      const { service, reports } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('MEMBER')],
      });

      await expect(
        service.answer({ status: 'forbidden' }, 'resumen'),
      ).resolves.toEqual({ status: 'refused', reason: 'forbidden' });
      await expect(
        service.answer({ status: 'unlinked' }, 'resumen'),
      ).resolves.toEqual({ status: 'refused', reason: 'unlinked' });
      expect(reports.generate).not.toHaveBeenCalled();
    });
  });

  describe('the report PDF command', () => {
    const authorized = {
      status: 'authorized' as const,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'ADMIN' as const,
      phone: PHONE,
    };

    it.each([
      'pdf',
      'PDF',
      'reporte pdf',
      'pdf del reporte',
      'manda el reporte',
      'Mándame el reporte',
      'envia el reporte',
      'manda el pdf',
    ])('sends the document on demand for %s', async (text) => {
      const { service, delivery, reports } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      await expect(service.answer(authorized, text)).resolves.toEqual({
        status: 'delivered',
        tool: 'daily_report_pdf',
        organizationId: ORGANIZATION_ID,
        delivery: 'sent',
      });

      // The destination is the sender's own verified number, and the gate never
      // reduces the report itself on this path.
      expect(delivery.onDemand).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        phone: PHONE,
      });
      expect(reports.generate).not.toHaveBeenCalled();
    });

    it('reports a failed delivery without throwing or leaking a reason code', async () => {
      const { service } = setup({
        onDemand: jest
          .fn()
          .mockResolvedValue({ status: 'failed', reason: 'provider_rejected' }),
      });

      const answer = await service.answer(authorized, 'pdf');

      expect(answer).toEqual({
        status: 'delivered',
        tool: 'daily_report_pdf',
        organizationId: ORGANIZATION_ID,
        delivery: 'failed',
      });
      expect(JSON.stringify(answer)).not.toContain('provider_rejected');
    });

    it('reports a delivery the service declined for lack of identity', async () => {
      const { service } = setup({
        onDemand: jest.fn().mockResolvedValue({ status: 'no_identity' }),
      });

      await expect(service.answer(authorized, 'pdf')).resolves.toEqual({
        status: 'delivered',
        tool: 'daily_report_pdf',
        organizationId: ORGANIZATION_ID,
        delivery: 'no_identity',
      });
    });

    it('never sends for a summary command, an unknown command or a refusal', async () => {
      const { service, delivery } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      await service.answer(authorized, 'resumen');
      await service.answer(authorized, 'cierre del dia');
      await service.answer(authorized, 'borra todo');
      await service.answer({ status: 'unlinked' }, 'pdf');
      await service.answer({ status: 'forbidden' }, 'manda el reporte');

      expect(delivery.onDemand).not.toHaveBeenCalled();
    });

    it('refuses rather than throwing when the delivery service fails', async () => {
      const { service } = setup({
        onDemand: jest.fn().mockRejectedValue(new Error('database is down')),
      });

      const answer: WhatsAppAdminAnswer = await service.answer(
        authorized,
        'pdf',
      );

      expect(answer).toEqual({ status: 'refused', reason: 'unavailable' });
      expect(JSON.stringify(answer)).not.toContain('database is down');
    });

    it('cannot be widened by a phone or an organization appended to the command', async () => {
      const { service, delivery } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      for (const text of [
        `pdf ${PHONE}`,
        `manda el reporte a 573009998877`,
        `pdf ${OTHER_ORGANIZATION_ID}`,
        'pdf;',
      ]) {
        await expect(service.answer(authorized, text)).resolves.toEqual({
          status: 'unsupported',
        });
      }

      expect(delivery.onDemand).not.toHaveBeenCalled();
    });
  });

  describe('no write is reachable', () => {
    it('only reads on every path and never opens a transaction', async () => {
      const { service, prisma } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });

      await service.authorize(PHONE);
      await service.answer(
        {
          status: 'authorized',
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          role: 'ADMIN',
          phone: PHONE,
        },
        'resumen',
      );
      await service.answer({ status: 'unlinked' }, 'resumen');
      await service.authorize('573001110000');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      for (const model of [prisma.whatsAppIdentity, prisma.organizationUser]) {
        for (const method of [
          'create',
          'update',
          'updateMany',
          'upsert',
          'delete',
          'deleteMany',
        ] as const) {
          expect(model[method]).not.toHaveBeenCalled();
        }
      }
      expect(prisma.whatsAppIdentity.findFirst).toHaveBeenCalled();
      expect(prisma.organizationUser.findFirst).toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    let loggerSpies: jest.SpyInstance[] = [];

    beforeEach(() => {
      loggerSpies = spyOnLogger();
    });

    afterEach(() => {
      loggerSpies.forEach((spy) => spy.mockRestore());
    });

    it('never logs the phone, the body or a figure', async () => {
      const { service } = setup({
        identities: [verifiedIdentity()],
        memberships: [membership('ADMIN')],
      });
      const stranger = setup({
        identities: [
          {
            phone: '573009998877',
            userId: STRANGER_USER_ID,
            organizationId: ORGANIZATION_ID,
            status: 'VERIFIED',
          },
        ],
        memberships: [membership('CASHIER')],
      });

      const authorized = await service.authorize(JID);
      await service.answer(authorized, 'resumen');
      await service.answer(authorized, 'borra todo');
      await service.answer(authorized, 'manda el reporte');
      await stranger.service.authorize('573009998877');
      await setup().service.authorize('573001110000');

      const logged = stringified(loggerSpies);

      // The refusals did log something, so the absence assertions mean something.
      expect(logged).toContain('whatsapp_admin');
      for (const secret of [
        PHONE,
        '573009998877',
        '573001110000',
        'resumen',
        'borra todo',
        'manda el reporte',
        '1234.56',
        '200.00',
        'Ana Cliente',
        '1020304050',
      ]) {
        expect(logged).not.toContain(secret);
      }
    });
  });
});
