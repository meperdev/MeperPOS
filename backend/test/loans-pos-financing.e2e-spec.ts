import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { configureApp, configureErrorHandling } from '../src/app-configuration';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E — financed POS loan journey over REAL HTTP + REAL PostgreSQL.
 *
 * Every assertion is observed through the booted AppModule (global `api`
 * prefix, cookie CSRF guard, JWT/role guards) or through the same rows the
 * handlers wrote — no provider mocks. The first setup step proves the
 * connected database is the isolated `meperpos_loans_verify`, so seeding and
 * cleanup can never touch `inventario_db`. Loan history is append-only via
 * SQL triggers, so cleanup uses `session_replication_role = replica` inside
 * one transaction to delete only this spec's rows.
 */

const VERIFY_DATABASE = 'meperpos_loans_verify';
const ORG_SLUG = 'e2e-loans-verify-org';
const CASHIER_EMAIL = 'e2e-loans-cashier@verify.local';
const INVENTORY_EMAIL = 'e2e-loans-inventory@verify.local';
const PASSWORD = 'Verify-Pass-123!';
const ISSUED_AT = '2026-10-09';
const INIT_KEY = 'e2e-loans-init-0001';
const COLLECT_PARTIAL_KEY = 'e2e-loans-collect-0001';
const COLLECT_FINAL_KEY = 'e2e-loans-collect-0002';
const COMPLETE_KEY = 'e2e-loans-complete-0001';

type CookieJar = Record<string, string>;

function readCookieJar(res: request.Response): CookieJar {
  const raw: unknown = res.headers['set-cookie'];
  const lines: string[] = Array.isArray(raw)
    ? raw.filter((line): line is string => typeof line === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];
  const jar: CookieJar = {};
  for (const line of lines) {
    const [pair] = line.split(';');
    const separator = pair.indexOf('=');
    if (separator > 0)
      jar[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return jar;
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

describe('Financed POS loan journey on real PostgreSQL (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let organizationId: string;
  let customerId: string;
  let productId: string;
  let serviceId: string;
  let cashierJar: CookieJar;
  let cashierToken: string;
  let inventoryToken: string;
  let intentId: string;
  let loanId: string;
  let saleId: string;

  const api = () => request(app.getHttpServer());
  const asCashierPost = (url: string) =>
    api().post(url).set('Authorization', `Bearer ${cashierToken}`);
  const asCashierGet = (url: string) =>
    api().get(url).set('Authorization', `Bearer ${cashierToken}`);
  const asInventoryPost = (url: string) =>
    api().post(url).set('Authorization', `Bearer ${inventoryToken}`);

  const initiationBody = () => ({
    customerId,
    requestKey: INIT_KEY,
    issuedAt: ISSUED_AT,
    reason: 'Venta financiada E2E',
    discountAmount: 5000,
    items: [
      { productId, quantity: 2 },
      { productId: serviceId, quantity: 1 },
    ],
  });

  // Each concurrency/rollback case gets its own tracked product and loan so
  // the counters and reservations of the original journey stay untouched.
  async function createTrackedProduct(sku: string) {
    const category = await prisma.category.findFirstOrThrow({
      where: { organizationId, name: 'Verificación' },
    });
    return prisma.product.create({
      data: {
        name: `Producto ${sku}`,
        sku,
        categoryId: category.id,
        organizationId,
        costPrice: 30000,
        salePrice: 50000,
        taxRate: 0,
        taxable: false,
        stock: 10,
        reservedStock: 0,
        type: 'PRODUCT',
        tracksStock: true,
      },
    });
  }

  async function initiateLoan(
    tag: string,
    trackedProductId: string,
    quantity = 2,
  ) {
    const res = await asCashierPost('/api/loans/pos-initiation').send({
      customerId,
      requestKey: `e2e-loans-${tag}-init`,
      issuedAt: ISSUED_AT,
      reason: `Financiación ${tag}`,
      items: [{ productId: trackedProductId, quantity }],
    });
    expect(res.status).toBe(201);
    return {
      intentId: res.body.intentId as string,
      loanId: res.body.loanId as string,
      total: res.body.agreedCustomerTotal as string,
    };
  }

  async function settleLoan(tag: string, targetLoanId: string, total: string) {
    const res = await asCashierPost(
      `/api/loans/${targetLoanId}/collections`,
    ).send({
      requestKey: `e2e-loans-${tag}-settle`,
      amount: Number(total),
      method: 'CASH',
    });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('0.00');
  }

  async function purge(): Promise<void> {
    const org = await prisma.organization.findUnique({
      where: { slug: ORG_SLUG },
      select: { id: true },
    });
    const organizationId = org?.id;
    // Static statements only: no identifier is ever interpolated into SQL.
    const scopedDeletes = [
      `DELETE FROM "InventoryMovement" WHERE "organizationId" = $1`,
      `DELETE FROM "Payment" WHERE "organizationId" = $1`,
      `DELETE FROM "SaleItem" WHERE "organizationId" = $1`,
      `DELETE FROM "MoneyLoanEvent" WHERE "organizationId" = $1`,
      `DELETE FROM "PosLoanSaleReservation" WHERE "organizationId" = $1`,
      `DELETE FROM "PosLoanSaleIntent" WHERE "organizationId" = $1`,
      `DELETE FROM "Sale" WHERE "organizationId" = $1`,
      `DELETE FROM "MoneyLoan" WHERE "organizationId" = $1`,
      `DELETE FROM "Product" WHERE "organizationId" = $1`,
      `DELETE FROM "Category" WHERE "organizationId" = $1`,
      `DELETE FROM "Customer" WHERE "organizationId" = $1`,
      `DELETE FROM "AuditLog" WHERE "organizationId" = $1`,
      `DELETE FROM "OrganizationSequence" WHERE "organizationId" = $1`,
      `DELETE FROM "OrganizationUser" WHERE "organizationId" = $1`,
    ];
    await prisma.$transaction(async (tx) => {
      // Append-only triggers block history deletes; replica role disables them
      // for this transaction only so the spec can remove its own rows.
      await tx.$executeRawUnsafe(
        `SET LOCAL session_replication_role = replica`,
      );
      if (organizationId) {
        for (const statement of scopedDeletes) {
          await tx.$executeRawUnsafe(statement, organizationId);
        }
        await tx.$executeRawUnsafe(
          `DELETE FROM "Organization" WHERE "id" = $1`,
          organizationId,
        );
      }
      await tx.$executeRawUnsafe(
        `DELETE FROM "RefreshToken" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ($1, $2))`,
        CASHIER_EMAIL,
        INVENTORY_EMAIL,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "User" WHERE email IN ($1, $2)`,
        CASHIER_EMAIL,
        INVENTORY_EMAIL,
      );
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
    prisma = app.get(PrismaService);

    const rows = await prisma.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    const connected = rows[0]?.current_database;
    if (connected !== VERIFY_DATABASE) {
      throw new Error(
        `Refusing to run: connected database is "${connected}", expected "${VERIFY_DATABASE}"`,
      );
    }

    await purge();
    const organization = await prisma.organization.create({
      data: { name: 'E2E Loans Verify', slug: ORG_SLUG, status: 'ACTIVE' },
    });
    organizationId = organization.id;

    const password = await bcrypt.hash(PASSWORD, 10);
    const cashier = await prisma.user.create({
      data: {
        email: CASHIER_EMAIL,
        password,
        name: 'Verify Cashier',
        active: true,
      },
    });
    const inventory = await prisma.user.create({
      data: {
        email: INVENTORY_EMAIL,
        password,
        name: 'Verify Inventory',
        active: true,
      },
    });
    await prisma.organizationUser.create({
      data: { userId: cashier.id, organizationId, role: 'CASHIER' },
    });
    await prisma.organizationUser.create({
      data: { userId: inventory.id, organizationId, role: 'INVENTORY_USER' },
    });
    // POS completion needs a pre-provisioned SALE sequence for the current year.
    await prisma.organizationSequence.create({
      data: {
        organizationId,
        type: 'SALE',
        year: new Date().getFullYear(),
        currentNumber: 0,
        prefix: 'VERIFY',
      },
    });
    const customer = await prisma.customer.create({
      data: {
        name: 'Cliente Verificado',
        documentType: 'CC',
        documentNumber: '900000001',
        organizationId,
      },
    });
    customerId = customer.id;

    const category = await prisma.category.create({
      data: { name: 'Verificación', organizationId },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Producto Verificado',
        sku: 'VERIFY-001',
        categoryId: category.id,
        organizationId,
        costPrice: 30000,
        salePrice: 50000,
        taxRate: 0,
        taxable: false,
        stock: 10,
        reservedStock: 1,
        type: 'PRODUCT',
        tracksStock: true,
      },
    });
    productId = product.id;
    const service = await prisma.product.create({
      data: {
        name: 'Servicio Verificado',
        sku: 'VERIFY-SVC',
        categoryId: category.id,
        organizationId,
        costPrice: 0,
        salePrice: 30000,
        taxRate: 0,
        taxable: false,
        stock: 0,
        reservedStock: 0,
        type: 'SERVICE',
        tracksStock: false,
      },
    });
    serviceId = service.id;
  }, 30000);

  afterAll(async () => {
    if (prisma) await purge();
    if (app) await app.close();
  }, 30000);

  it('1. logs in over HTTP, sets the session cookies, and enforces CSRF', async () => {
    const login = await api()
      .post('/api/auth/login')
      .send({ email: CASHIER_EMAIL, password: PASSWORD });
    expect(login.status).toBe(201);
    expect(typeof login.body.accessToken).toBe('string');
    expect(login.body.refreshToken).toBeUndefined();
    cashierJar = readCookieJar(login);
    cashierToken = login.body.accessToken;
    expect(Object.keys(cashierJar)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']),
    );

    // A cookie session that omits the double-submit header must be rejected
    // before authentication is even evaluated.
    const blocked = await api()
      .post('/api/loans/pos-initiation')
      .set('Cookie', cookieHeader(cashierJar))
      .send(initiationBody());
    expect(blocked.status).toBe(403);
  });

  it('2. initiates the financing, applies the discount, and reserves stock', async () => {
    const res = await asCashierPost('/api/loans/pos-initiation')
      .set('Cookie', cookieHeader(cashierJar))
      .set('x-csrf-token', cashierJar.csrf_token)
      .send(initiationBody());
    expect(res.status).toBe(201);
    expect(res.body.agreedCustomerTotal).toBe('125000.00');
    expect(res.body.quoteSnapshot.agreedCustomerTotal).toBe('125000.00');
    expect(res.body.quoteSnapshot.discountAmount).toBe('5000.00');
    expect(res.body.quoteSnapshot.items).toHaveLength(2);
    intentId = res.body.intentId;
    loanId = res.body.loanId;

    const loan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loanId, organizationId },
    });
    expect(loan).toMatchObject({ status: 'OPEN', customerId });
    expect(loan.amount.toFixed(2)).toBe('125000.00');
    const intent = await prisma.posLoanSaleIntent.findUniqueOrThrow({
      where: { id: intentId },
    });
    expect(intent).toMatchObject({ initiationRequestKey: INIT_KEY });
    expect(intent.agreedCustomerTotal?.toFixed(2)).toBe('125000.00');

    // The reservation consumes availability, not physical stock.
    const tracked = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(tracked).toMatchObject({ stock: 10, reservedStock: 3 });
    const service = await prisma.product.findUniqueOrThrow({
      where: { id: serviceId },
    });
    expect(service).toMatchObject({ stock: 0, reservedStock: 0 });
    const holds = await prisma.posLoanSaleReservation.findMany({
      where: { intentId },
    });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ productId, quantity: 2, state: 'HELD' });
  });

  it('3. replays the initiation key and conflicts on a different payload', async () => {
    const replay = await asCashierPost('/api/loans/pos-initiation').send(
      initiationBody(),
    );
    expect(replay.status).toBe(201);
    expect(replay.body.intentId).toBe(intentId);
    expect(replay.body.loanId).toBe(loanId);
    expect(
      await prisma.posLoanSaleIntent.findMany({
        where: { organizationId, initiationRequestKey: INIT_KEY },
      }),
    ).toHaveLength(1);

    const changed = initiationBody();
    changed.items = [{ productId, quantity: 3 }];
    const conflict = await asCashierPost('/api/loans/pos-initiation').send(
      changed,
    );
    expect(conflict.status).toBe(409);
  });

  it('4. lists the loan and serves its history through the API', async () => {
    const list = await asCashierGet('/api/loans?type=MONEY');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(
      list.body.data.some((loan: { id: string }) => loan.id === loanId),
    ).toBe(true);

    const history = await asCashierGet(`/api/loans/${loanId}/history`);
    expect(history.status).toBe(200);
    expect(
      history.body.data.map((event: { type: string }) => event.type),
    ).toContain('CREATED');
  });

  it('5. records a partial collection idempotently', async () => {
    const body = {
      requestKey: COLLECT_PARTIAL_KEY,
      amount: 50000,
      method: 'CASH',
    };
    const collect = await asCashierPost(
      `/api/loans/${loanId}/collections`,
    ).send(body);
    expect(collect.status).toBe(201);
    expect(collect.body).toMatchObject({
      balance: '75000.00',
      paymentStatus: 'PARTIAL',
    });

    const replay = await asCashierPost(`/api/loans/${loanId}/collections`).send(
      body,
    );
    expect(replay.status).toBe(201);
    expect(replay.body.eventId).toBe(collect.body.eventId);
    expect(replay.body.balance).toBe('75000.00');
    expect(
      await prisma.moneyLoanEvent.findMany({
        where: { organizationId, loanId, requestKey: COLLECT_PARTIAL_KEY },
      }),
    ).toHaveLength(1);
    expect(
      await prisma.moneyLoanEvent.count({
        where: { organizationId, loanId, type: 'COLLECTED' },
      }),
    ).toBe(1);
  });

  it('6. completes the fully paid financing into exactly one sale', async () => {
    const settled = await asCashierPost(
      `/api/loans/${loanId}/collections`,
    ).send({ requestKey: COLLECT_FINAL_KEY, amount: 75000, method: 'CASH' });
    expect(settled.body).toMatchObject({
      balance: '0.00',
      paymentStatus: 'PAID',
    });

    const completion = await asCashierPost(
      `/api/loans/${loanId}/pos-completion`,
    ).send({ requestKey: COMPLETE_KEY });
    expect(completion.status).toBe(201);
    expect(completion.body.status).toBe('CLOSED');
    saleId = completion.body.saleId;

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale).toMatchObject({ status: 'COMPLETED' });
    expect(sale.total.toFixed(2)).toBe('125000.00');
    expect(sale.amountPaid.toFixed(2)).toBe('125000.00');
    expect(await prisma.payment.count({ where: { saleId } })).toBe(0);

    const holds = await prisma.posLoanSaleReservation.findMany({
      where: { intentId },
    });
    expect(holds).toHaveLength(1);
    expect(holds[0].state).toBe('CONSUMED');
    const tracked = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(tracked).toMatchObject({ stock: 8, reservedStock: 1 });
    const movements = await prisma.inventoryMovement.findMany({
      where: { saleId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId,
      type: 'SALE',
      quantity: -2,
      previousStock: 10,
      newStock: 8,
    });
    expect(
      (await prisma.moneyLoan.findFirstOrThrow({ where: { id: loanId } }))
        .status,
    ).toBe('CLOSED');

    const replay = await asCashierPost(
      `/api/loans/${loanId}/pos-completion`,
    ).send({ requestKey: COMPLETE_KEY });
    expect(replay.status).toBe(201);
    expect(replay.body.saleId).toBe(saleId);
    expect(await prisma.sale.count({ where: { organizationId } })).toBe(1);
  });

  it('7. refuses roles without financing rights and unauthenticated callers', async () => {
    const login = await api()
      .post('/api/auth/login')
      .send({ email: INVENTORY_EMAIL, password: PASSWORD });
    expect(login.status).toBe(201);
    inventoryToken = login.body.accessToken;

    const deniedInitiation = await asInventoryPost(
      '/api/loans/pos-initiation',
    ).send({
      customerId,
      requestKey: 'e2e-loans-denied-0001',
      issuedAt: ISSUED_AT,
      reason: 'No autorizado',
      items: [{ productId, quantity: 1 }],
    });
    expect(deniedInitiation.status).toBe(403);

    const deniedCompletion = await asInventoryPost(
      `/api/loans/${loanId}/pos-completion`,
    ).send({ requestKey: 'e2e-loans-denied-0002' });
    expect(deniedCompletion.status).toBe(403);
    expect((await api().get('/api/loans')).status).toBe(401);
  });

  it('8. parallel completion with different keys yields exactly one sale', async () => {
    const tracked = await createTrackedProduct('VERIFY-CONC-A');
    const loan = await initiateLoan('conc-a', tracked.id);
    await settleLoan('conc-a', loan.loanId, loan.total);

    const before = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loan.loanId },
    });
    expect(before.status).toBe('OPEN');

    const keyA = 'e2e-loans-conc-a-claim-1';
    const keyB = 'e2e-loans-conc-a-claim-2';
    const [first, second] = await Promise.all([
      asCashierPost(`/api/loans/${loan.loanId}/pos-completion`).send({
        requestKey: keyA,
      }),
      asCashierPost(`/api/loans/${loan.loanId}/pos-completion`).send({
        requestKey: keyB,
      }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const winner = first.status === 201 ? first : second;
    const loser = first.status === 409 ? first : second;
    const losingKey = loser === first ? keyA : keyB;

    const linkedSales = await prisma.sale.findMany({
      where: { posLoanSaleIntent: { is: { id: loan.intentId } } },
    });
    expect(linkedSales).toHaveLength(1);
    expect(linkedSales[0].id).toBe(winner.body.saleId);
    expect(linkedSales[0].status).toBe('COMPLETED');

    const after = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loan.loanId },
    });
    expect(after.status).toBe('CLOSED');
    expect(after.version).toBe(before.version + 1);

    // Stock and reservation counters moved exactly one step, never twice.
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: tracked.id },
    });
    expect(product).toMatchObject({ stock: 8, reservedStock: 0 });
    expect(
      await prisma.inventoryMovement.count({
        where: { productId: tracked.id, type: 'SALE' },
      }),
    ).toBe(1);
    const holds = await prisma.posLoanSaleReservation.findMany({
      where: { intentId: loan.intentId },
    });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ state: 'CONSUMED' });
    expect(holds[0].finalizedAt).not.toBeNull();

    expect(
      await prisma.moneyLoanEvent.count({
        where: { loanId: loan.loanId, type: 'CLOSED' },
      }),
    ).toBe(1);
    expect(
      await prisma.moneyLoanEvent.count({
        where: { loanId: loan.loanId, requestKey: losingKey },
      }),
    ).toBe(0);
  });

  it('9. parallel completion with the same key never creates a second sale', async () => {
    const tracked = await createTrackedProduct('VERIFY-CONC-B');
    const loan = await initiateLoan('conc-b', tracked.id);
    await settleLoan('conc-b', loan.loanId, loan.total);

    const key = 'e2e-loans-conc-b-claim';
    const [first, second] = await Promise.all([
      asCashierPost(`/api/loans/${loan.loanId}/pos-completion`).send({
        requestKey: key,
      }),
      asCashierPost(`/api/loans/${loan.loanId}/pos-completion`).send({
        requestKey: key,
      }),
    ]);
    // Serializable isolation admits a single completion. The losing caller is
    // refused (409) before it can observe the winner's committed event, so it
    // cannot return a body in the same shot; the stored saleId shared by the
    // winner's response and the persisted intent is what proves idempotency.
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const accepted = first.status === 201 ? first : second;
    const intent = await prisma.posLoanSaleIntent.findUniqueOrThrow({
      where: { id: loan.intentId },
    });
    expect(intent.finalSaleId).toBe(accepted.body.saleId);
    const linkedSales = await prisma.sale.findMany({
      where: { posLoanSaleIntent: { is: { id: loan.intentId } } },
    });
    expect(linkedSales).toHaveLength(1);
    expect(linkedSales[0].id).toBe(intent.finalSaleId);
    expect(
      await prisma.moneyLoanEvent.count({
        where: { loanId: loan.loanId, requestKey: key },
      }),
    ).toBe(1);
    expect(
      await prisma.moneyLoanEvent.count({
        where: { loanId: loan.loanId, type: 'CLOSED' },
      }),
    ).toBe(1);
  });

  it('10. rolls back a mid-transaction completion failure without partial writes', async () => {
    const tracked = await createTrackedProduct('VERIFY-ROLLBACK');
    const loan = await initiateLoan('rollback', tracked.id);
    await settleLoan('rollback', loan.loanId, loan.total);

    // Deplete the held reservation counter so the hold claim cannot succeed
    // after the loan status, sale and sale items have already been written.
    await prisma.product.update({
      where: { id: tracked.id },
      data: { reservedStock: 0 },
    });
    const beforeLoan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loan.loanId },
    });
    const beforeProduct = await prisma.product.findUniqueOrThrow({
      where: { id: tracked.id },
    });

    const rollbackKey = 'e2e-loans-rollback-claim';
    const response = await asCashierPost(
      `/api/loans/${loan.loanId}/pos-completion`,
    ).send({ requestKey: rollbackKey });
    expect(response.status).toBe(409);

    // The transaction wrote the loan transition, the sale and its items before
    // the failing hold claim; rollback must leave none of it behind.
    expect(
      await prisma.sale.count({
        where: { posLoanSaleIntent: { is: { id: loan.intentId } } },
      }),
    ).toBe(0);
    expect(
      await prisma.saleItem.count({ where: { productId: tracked.id } }),
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.count({
        where: { productId: tracked.id },
      }),
    ).toBe(0);
    expect(
      await prisma.moneyLoanEvent.count({
        where: { loanId: loan.loanId, requestKey: rollbackKey },
      }),
    ).toBe(0);
    expect(
      await prisma.moneyLoanEvent.count({
        where: { loanId: loan.loanId, type: 'CLOSED' },
      }),
    ).toBe(0);

    const holds = await prisma.posLoanSaleReservation.findMany({
      where: { intentId: loan.intentId },
    });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ state: 'HELD' });
    expect(holds[0].finalizedAt).toBeNull();
    const intent = await prisma.posLoanSaleIntent.findUniqueOrThrow({
      where: { id: loan.intentId },
    });
    expect(intent.finalSaleId).toBeNull();

    const afterLoan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loan.loanId },
    });
    expect(afterLoan.status).toBe('OPEN');
    expect(afterLoan.version).toBe(beforeLoan.version);
    const afterProduct = await prisma.product.findUniqueOrThrow({
      where: { id: tracked.id },
    });
    expect(afterProduct.stock).toBe(beforeProduct.stock);
    expect(afterProduct.reservedStock).toBe(beforeProduct.reservedStock);
  });
});
