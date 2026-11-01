import type { PrismaService } from '../prisma/prisma.service';
import type { DailyReportService } from '../reports/daily-report.service';
import type { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import type { WhatsAppSupervisionService } from './whatsapp-supervision.service';
import {
  renderAdminReply,
  WhatsAppAdminService,
} from './whatsapp-admin.service';
import type {
  WhatsAppModelProvider,
  WhatsAppModelRequest,
  WhatsAppModelResult,
} from './whatsapp-intelligence-model';

/**
 * The model seam as it reaches the gate. These are boundary tests: the model is
 * untrusted output, so what matters is that it can only ever select one of the
 * closed read tools, that it never supplies an organization or a recipient, and
 * that it cannot make the gate send a document.
 *
 * The first case is the one that matters most today: while no provider is
 * chosen, the administrative channel must answer exactly as it did before the
 * seam existed — same sentence, nothing read, nothing sent.
 */

const ORGANIZATION_ID = 'org-1';
const OTHER_ORGANIZATION_ID = 'org-2';
const USER_ID = 'user-1';
const PHONE = '573001112233';
const UNSUPPORTED_REPLY =
  'No entiendo ese comando. Escribe «resumen» para las cifras del día, «atencion» para las conversaciones o «pdf» para el reporte.';

const report = {
  cutoff: new Date('2026-03-04T01:00:00.000Z'),
  date: '2026-03-03',
  salesTotal: '1234.56',
  expenseTotal: '200.00',
  sales: [{ id: 'sale-1' }],
  expenses: [],
  lowStock: [{ id: 'product-1' }],
  purchaseOrders: [],
  loans: [],
};

const supervisionSummary = {
  totalConversations: 3,
  byState: { AUTOMATED: 1, HUMAN: 2, SUSPENDED: 0 },
  byContactKind: { CLIENT: 2, INTERNAL: 1, UNKNOWN: 0 },
  pendingAnswerCount: 1,
  firstResponse: { sampleCount: 2, medianMs: 3000 },
};

function buildService(interpret: jest.Mock) {
  const prisma = {
    whatsAppIdentity: {
      findFirst: jest.fn().mockResolvedValue({
        phone: PHONE,
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        status: 'VERIFIED',
      }),
    },
    organizationUser: {
      findFirst: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    },
    // A live account and a live organization, which the gate also requires.
    user: { findFirst: jest.fn().mockResolvedValue({ id: USER_ID }) },
    organization: {
      findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    },
  };
  const reports = { generate: jest.fn().mockResolvedValue(report) };
  const delivery = {
    onDemand: jest
      .fn()
      .mockResolvedValue({ status: 'sent', providerMessageId: 'wamid-1' }),
  };
  const supervision = {
    summary: jest.fn().mockResolvedValue(supervisionSummary),
  };

  const model: WhatsAppModelProvider = { interpret };
  const service = new WhatsAppAdminService(
    prisma as unknown as PrismaService,
    new WhatsAppIdentityService(prisma as unknown as PrismaService),
    reports as unknown as DailyReportService,
    delivery as unknown as WhatsAppDeliveryService,
    supervision as unknown as WhatsAppSupervisionService,
    model,
  );

  return { service, prisma, reports, delivery, supervision };
}

const refused = () => jest.fn().mockResolvedValue({ status: 'unavailable' });

const intent = (tool: string, extra: Record<string, unknown> = {}) =>
  jest.fn().mockResolvedValue({
    status: 'intent',
    intent: { tool, ...extra },
  } as WhatsAppModelResult);

describe('administrative gate with the model seam', () => {
  it('answers an unknown command exactly as before while no provider is chosen', async () => {
    const interpret = refused();
    const { service, reports, delivery } = buildService(interpret);
    const context = await service.authorize(PHONE);

    const answer = await service.answer(context, 'cuanto vendimos hoy');

    expect(answer.status).toBe('unsupported');
    expect(renderAdminReply(answer)).toBe(UNSUPPORTED_REPLY);
    expect(interpret).toHaveBeenCalledTimes(1);
    // Nothing is read and nothing is sent when the model refuses.
    expect(reports.generate).not.toHaveBeenCalled();
    expect(delivery.onDemand).not.toHaveBeenCalled();
  });

  it('sends only the normalised text and the closed catalogue to the provider', async () => {
    const interpret = refused();
    const { service } = buildService(interpret);
    const context = await service.authorize(PHONE);

    await service.answer(context, '  Cuánto   VENDIMOS hoy ');

    const request = interpret.mock.calls[0][0] as WhatsAppModelRequest;
    expect(Object.keys(request)).toEqual(['text', 'tools', 'timeoutMs']);
    expect(request.text).toBe('cuanto vendimos hoy');
    // No phone, no identity, no organization, no figure, no conversation.
    expect(JSON.stringify(request)).not.toContain(PHONE);
    expect(JSON.stringify(request)).not.toContain(ORGANIZATION_ID);
    expect(JSON.stringify(request)).not.toContain(USER_ID);
  });

  it('runs the read tool only after a validated intent, for the identity organization', async () => {
    const interpret = intent('daily_summary');
    const { service, reports, delivery } = buildService(interpret);
    const context = await service.authorize(PHONE);

    const answer = await service.answer(
      context,
      'como va el negocio hoy en la organizacion org-2',
    );

    expect(answer.status).toBe('answered');
    if (answer.status !== 'answered' || answer.tool !== 'daily_summary') return;
    expect(answer.organizationId).toBe(ORGANIZATION_ID);
    expect(reports.generate).toHaveBeenCalledTimes(1);
    expect(reports.generate).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(reports.generate).not.toHaveBeenCalledWith(OTHER_ORGANIZATION_ID);
    expect(delivery.onDemand).not.toHaveBeenCalled();
    expect(renderAdminReply(answer)).toContain('Ventas:');
  });

  it('runs the supervision tool when the model selects it', async () => {
    const interpret = intent('supervision_summary');
    const { service, supervision } = buildService(interpret);
    const context = await service.authorize(PHONE);

    const answer = await service.answer(context, 'como viene la atencion');

    expect(answer.status).toBe('answered');
    expect(supervision.summary).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(renderAdminReply(answer)).toContain(
      'Atención de las conversaciones',
    );
  });

  it('refuses an intent that leaves the catalogue, including the document tool', async () => {
    for (const tool of ['daily_report_pdf', 'list_customers', 'create_sale']) {
      const interpret = intent(tool);
      const { service, reports, delivery } = buildService(interpret);
      const context = await service.authorize(PHONE);

      const answer = await service.answer(context, 'manda el reporte ya');

      expect(answer.status).toBe('unsupported');
      expect(reports.generate).not.toHaveBeenCalled();
      expect(delivery.onDemand).not.toHaveBeenCalled();
    }
  });

  it('refuses an intent that carries any parameter or identifier', async () => {
    for (const extra of [
      { organizationId: OTHER_ORGANIZATION_ID },
      { phone: '573009998877' },
      { since: '2026-01-01' },
      { customerId: 'customer-1' },
    ]) {
      const interpret = intent('daily_summary', extra);
      const { service, reports } = buildService(interpret);
      const context = await service.authorize(PHONE);

      const answer = await service.answer(context, 'dame los numeros');

      expect(answer.status).toBe('unsupported');
      expect(reports.generate).not.toHaveBeenCalled();
    }
  });

  it('treats every non-intent answer as unsupported', async () => {
    for (const result of [
      { status: 'unsupported' },
      { status: 'unavailable' },
      { status: 'intent' },
      { status: 'intent', intent: null },
      { status: 'intent', intent: 'daily_summary' },
      { status: 'intent', intent: ['daily_summary'] },
      {},
    ]) {
      const interpret = jest.fn().mockResolvedValue(result);
      const { service, reports } = buildService(interpret);
      const context = await service.authorize(PHONE);

      const answer = await service.answer(context, 'dame los numeros');

      expect(answer.status).toBe('unsupported');
      expect(reports.generate).not.toHaveBeenCalled();
    }
  });

  it('survives a provider that throws and never lets it fail the webhook', async () => {
    const interpret = jest
      .fn()
      .mockRejectedValue(new Error('provider exploded'));
    const { service, reports, delivery } = buildService(interpret);
    const context = await service.authorize(PHONE);

    const answer = await service.answer(context, 'dame los numeros');

    expect(answer.status).toBe('unsupported');
    expect(reports.generate).not.toHaveBeenCalled();
    expect(delivery.onDemand).not.toHaveBeenCalled();
  });

  it('never asks the model for a command the allowlist already answers', async () => {
    for (const text of ['resumen', 'atencion']) {
      const interpret = refused();
      const { service } = buildService(interpret);
      const context = await service.authorize(PHONE);

      await service.answer(context, text);

      expect(interpret).not.toHaveBeenCalled();
    }
  });

  it('never asks the model for a text over the size bound', async () => {
    const interpret = refused();
    const { service, reports } = buildService(interpret);
    const context = await service.authorize(PHONE);

    const answer = await service.answer(context, 'x'.repeat(513));

    expect(interpret).not.toHaveBeenCalled();
    expect(answer.status).toBe('unsupported');
    expect(reports.generate).not.toHaveBeenCalled();
  });

  it('always answers with the deterministic reply for a stranger, model or not', async () => {
    const interpret = intent('daily_summary');
    const { service, prisma, reports } = buildService(interpret);
    prisma.whatsAppIdentity.findFirst.mockResolvedValue(null);
    const context = await service.authorize(PHONE);

    const answer = await service.answer(context, 'cuanto vendimos hoy');

    expect(answer.status).toBe('refused');
    // Silence: no reply text at all, so the number cannot be enumerated.
    expect(renderAdminReply(answer)).toBeNull();
    expect(interpret).not.toHaveBeenCalled();
    expect(reports.generate).not.toHaveBeenCalled();
  });
});
