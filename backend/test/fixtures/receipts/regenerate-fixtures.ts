/**
 * Regeneration script for the receipt golden fixtures (S3 — perf-refactor #98).
 *
 * Creates 6 deterministic, org-scoped fixture sales in the local database and
 * generates the baseline receipt PDFs with the CURRENT receipt renderer. The
 * committed artifacts produced here are the equality gate for receipt layout
 * changes:
 *
 *   - pdf/fixture-<n>-<slug>.pdf   baseline PDF per fixture (human-readable)
 *   - baselines.json               normalized pdf-parse extraction per fixture
 *   - fixture-inputs.json          exact (sale, settings) JSON per fixture
 *
 * The script is idempotent: fixture orgs/users/products/customers are upserted
 * by unique keys and fixture sales are deleted and recreated, so re-running it
 * regenerates byte-stable text baselines.
 *
 * Usage (from /backend): npm run fixtures:receipts
 */
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CacheService } from '../../../src/common/services/cache.service';
import { SettingsService } from '../../../src/settings/settings.service';
import { CloudinaryService } from '../../../src/cloudinary/cloudinary.service';
import { SequenceService } from '../../../src/common/sequences/sequence.service';
import { ReceiptsService } from '../../../src/receipts/receipts.service';
import { SalesService } from '../../../src/sales/sales.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  b: Buffer,
) => Promise<{ text: string }>;

/** Fixed instant so date/time rendering is reproducible (09:30 Bogota). */
const FIXED_CREATED_AT = new Date('2026-06-15T14:30:00.000Z');
const SEQUENCE_YEAR = 2026;
const PDF_DIR = path.join(__dirname, 'pdf');

const ORG_A_SLUG = 's3-receipt-fixtures';
const ORG_B_SLUG = 's3-receipt-fixtures-b';
const FIXTURE_USER_EMAIL = 's3-receipt-fixtures@example.com';

// 1x1 PNG data URL: exercises the successful logo branch of the builder
// deterministically (image bytes never reach text extraction).
const LOGO_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface StubResponse {
  setHeader: (name: string, value: string) => void;
  send: (body: Buffer) => void;
}

function normalizeExtracted(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function ensureUser(prisma: PrismaService): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: FIXTURE_USER_EMAIL },
    update: {},
    create: {
      email: FIXTURE_USER_EMAIL,
      password: '$2a$10$fixture-only-hash-not-a-real-password0123456789abcd',
      name: 'S3 Fixture Admin',
    },
  });
  return user.id;
}

async function ensureOrganization(
  prisma: PrismaService,
  data: {
    slug: string;
    name: string;
    settings: Record<string, unknown>;
    logoUrl?: string | null;
  },
): Promise<string> {
  const org = await prisma.organization.upsert({
    where: { slug: data.slug },
    update: { name: data.name, settings: data.settings as object, logoUrl: data.logoUrl ?? null },
    create: {
      slug: data.slug,
      name: data.name,
      settings: data.settings as object,
      logoUrl: data.logoUrl ?? null,
    },
  });
  return org.id;
}

async function ensureSequence(
  prisma: PrismaService,
  organizationId: string,
  prefix: string,
): Promise<void> {
  await prisma.organizationSequence.upsert({
    where: {
      organizationId_type_year: { organizationId, type: 'SALE', year: SEQUENCE_YEAR },
    },
    update: { prefix },
    create: { organizationId, type: 'SALE', year: SEQUENCE_YEAR, prefix, currentNumber: 0 },
  });
}

async function ensureOrgUser(
  prisma: PrismaService,
  userId: string,
  organizationId: string,
): Promise<void> {
  await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    update: { role: 'ADMIN' },
    create: { userId, organizationId, role: 'ADMIN', isPrimaryOwner: true },
  });
}

async function ensureCategory(
  prisma: PrismaService,
  organizationId: string,
  name: string,
): Promise<string> {
  const category = await prisma.category.upsert({
    where: { organizationId_name: { organizationId, name } },
    update: {},
    create: { organizationId, name },
  });
  return category.id;
}

interface FixtureProduct {
  name: string;
  sku: string;
  salePrice: number;
  taxRate: number;
  taxable: boolean;
}

async function ensureProduct(
  prisma: PrismaService,
  organizationId: string,
  categoryId: string,
  p: FixtureProduct,
): Promise<string> {
  const product = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId, sku: p.sku } },
    update: { name: p.name, salePrice: p.salePrice, taxRate: p.taxRate, taxable: p.taxable },
    create: {
      organizationId,
      categoryId,
      name: p.name,
      sku: p.sku,
      costPrice: p.salePrice * 0.6,
      salePrice: p.salePrice,
      taxRate: p.taxRate,
      taxable: p.taxable,
      stock: 100,
      minStock: 5,
    },
  });
  return product.id;
}

async function ensureCustomer(
  prisma: PrismaService,
  organizationId: string,
  data: { name: string; documentNumber: string },
): Promise<string> {
  const customer = await prisma.customer.upsert({
    where: {
      organizationId_documentNumber: { organizationId, documentNumber: data.documentNumber },
    },
    update: { name: data.name },
    create: {
      organizationId,
      name: data.name,
      documentType: 'CC',
      documentNumber: data.documentNumber,
    },
  });
  return customer.id;
}

async function recreateSale(
  prisma: PrismaService,
  organizationId: string,
  userId: string,
  sale: {
    saleNumber: number;
    customerId: string | null;
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    total: number;
    amountPaid: number;
    change: number | null;
    items: Array<{ productId: string; quantity: number; unitPrice: number; taxRate: number }>;
    payments: Array<{ method: 'CASH' | 'CARD' | 'TRANSFER'; amount: number }>;
  },
): Promise<string> {
  // Fixture orgs are dedicated: wipe any previous fixture sale (children first).
  const previous = await prisma.sale.findMany({
    where: { organizationId, saleNumber: sale.saleNumber },
    select: { id: true },
  });
  const previousIds = previous.map((s) => s.id);
  if (previousIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { saleId: { in: previousIds } } });
    await prisma.saleItem.deleteMany({ where: { saleId: { in: previousIds } } });
    await prisma.payment.deleteMany({ where: { saleId: { in: previousIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: previousIds } } });
  }

  const created = await prisma.sale.create({
    data: {
      organizationId,
      userId,
      saleNumber: sale.saleNumber,
      customerId: sale.customerId,
      subtotal: sale.subtotal,
      taxAmount: sale.taxAmount,
      discountAmount: sale.discountAmount,
      total: sale.total,
      amountPaid: sale.amountPaid,
      change: sale.change,
      status: 'COMPLETED',
      createdAt: FIXED_CREATED_AT,
      items: {
        create: sale.items.map((item) => {
          const lineSubtotal = item.quantity * item.unitPrice;
          return {
            organizationId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            subtotal: lineSubtotal,
            total: lineSubtotal,
          };
        }),
      },
      payments: {
        create: sale.payments.map((payment) => ({
          organizationId,
          method: payment.method,
          amount: payment.amount,
        })),
      },
    },
  });
  return created.id;
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const cache = new CacheService();
  const cloudinary = new CloudinaryService(new ConfigService());
  const settingsService = new SettingsService(prisma, cloudinary);
  const salesService = new SalesService(
    prisma,
    cache,
    settingsService,
    new SequenceService(),
    new ReceiptsService(),
  );

  const userId = await ensureUser(prisma);

  // ---- Org A: normal settings (no header/footer, no logo) for fixtures 1-5 ----
  const orgAId = await ensureOrganization(prisma, {
    slug: ORG_A_SLUG,
    name: 'Tienda S3 Fixtures',
    settings: { printHeader: '', printFooter: '' },
  });
  await ensureOrgUser(prisma, userId, orgAId);
  await ensureSequence(prisma, orgAId, 'REC');
  const catAId = await ensureCategory(prisma, orgAId, 'S3 Fixtures');

  const panelaId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Panela Molida Tradicional',
    sku: 'S3-001',
    salePrice: 1500,
    taxRate: 19,
    taxable: true,
  });
  const cafeMolidoId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Café Molido Especial',
    sku: 'S3-002',
    salePrice: 12000,
    taxRate: 19,
    taxable: true,
  });
  const tazaId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Taza Cerámica Artesanal',
    sku: 'S3-003',
    salePrice: 8000,
    taxRate: 0,
    taxable: false,
  });
  const cafeArabeId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Café Árabe Íntenso Ñoño "Premium"',
    sku: 'S3-004',
    salePrice: 3500,
    taxRate: 19,
    taxable: true,
  });
  const pinataId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Piñata "Fiesta" Ñandú',
    sku: 'S3-005',
    salePrice: 1500,
    taxRate: 0,
    taxable: false,
  });
  const anejoId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Añejo Ñoqué',
    sku: 'S3-006',
    salePrice: 2500,
    taxRate: 0,
    taxable: false,
  });
  const arepaId = await ensureProduct(prisma, orgAId, catAId, {
    name: 'Arepa Rellena de Queso',
    sku: 'S3-007',
    salePrice: 5900,
    taxRate: 19,
    taxable: true,
  });

  const customer1Id = await ensureCustomer(prisma, orgAId, {
    name: 'Ana María Torres',
    documentNumber: 'S3-1001',
  });
  const customer2Id = await ensureCustomer(prisma, orgAId, {
    name: 'Carlos Andrés Gómez',
    documentNumber: 'S3-1002',
  });
  const customer3Id = await ensureCustomer(prisma, orgAId, {
    name: 'José Muñoz Ñíguez "Pepe"',
    documentNumber: 'S3-1003',
  });

  // ---- Org B: long header/footer + logo + long name for fixture 6 ----
  const orgBId = await ensureOrganization(prisma, {
    slug: ORG_B_SLUG,
    name: 'Comercializadora La Esquina Del Barrio Y Asociados S.A.S. Zona Norte',
    settings: {
      printHeader:
        'Distribuidora Mayorista y Minorista — Factura simplificada de venta. Resolución DIAN 18764000000001 de 2026. Regímen simple de tributación. Los cambios se aceptan únicamente con este comprobante dentro de los 30 días siguientes a la compra.',
      printFooter:
        '¡Gracias por su compra! Conserve este recibo para garantías, cambios, devoluciones y reclamos. Horario de atención: lunes a sábado 8:00 a.m. - 8:00 p.m., domingos y festivos 9:00 a.m. - 2:00 p.m. Línea de servicio al cliente 601-555-0198 ext. 402. Visite nuestra sucursal principal en la Carrera 15 # 88-64, Bogotá D.C.',
    },
    logoUrl: LOGO_DATA_URL,
  });
  await ensureOrgUser(prisma, userId, orgBId);
  await ensureSequence(prisma, orgBId, 'FAC-2026');
  const catBId = await ensureCategory(prisma, orgBId, 'S3 Fixtures');
  const mochilaId = await ensureProduct(prisma, orgBId, catBId, {
    name: 'Mochila Artesanal Tejida a Mano',
    sku: 'S3-B01',
    salePrice: 45000,
    taxRate: 19,
    taxable: true,
  });
  const customerB1Id = await ensureCustomer(prisma, orgBId, {
    name: 'Laura Sofía Ventura',
    documentNumber: 'S3-2001',
  });

  // ---- Fixture sales ----
  const fixture1SaleId = await recreateSale(prisma, orgAId, userId, {
    saleNumber: 1001,
    customerId: customer1Id,
    subtotal: 3000,
    taxAmount: 570,
    discountAmount: 0,
    total: 3570,
    amountPaid: 5000,
    change: 1430,
    items: [{ productId: panelaId, quantity: 2, unitPrice: 1500, taxRate: 19 }],
    payments: [{ method: 'CASH', amount: 5000 }],
  });

  const fixture2SaleId = await recreateSale(prisma, orgAId, userId, {
    saleNumber: 1002,
    customerId: customer2Id,
    subtotal: 36000,
    taxAmount: 2280,
    discountAmount: 0,
    total: 38280,
    amountPaid: 38280,
    change: null,
    items: [
      { productId: cafeMolidoId, quantity: 1, unitPrice: 12000, taxRate: 19 },
      { productId: tazaId, quantity: 3, unitPrice: 8000, taxRate: 0 },
    ],
    payments: [
      { method: 'CASH', amount: 20000 },
      { method: 'CARD', amount: 18280 },
    ],
  });

  const fixture3SaleId = await recreateSale(prisma, orgAId, userId, {
    saleNumber: 1003,
    customerId: customer3Id,
    subtotal: 5000,
    taxAmount: 665,
    discountAmount: 0,
    total: 5665,
    amountPaid: 5665,
    change: null,
    items: [
      { productId: cafeArabeId, quantity: 1, unitPrice: 3500, taxRate: 19 },
      { productId: pinataId, quantity: 1, unitPrice: 1500, taxRate: 0 },
    ],
    payments: [{ method: 'CARD', amount: 5665 }],
  });

  const fixture4SaleId = await recreateSale(prisma, orgAId, userId, {
    saleNumber: 1004,
    customerId: customer1Id,
    subtotal: 2500,
    taxAmount: 0,
    discountAmount: 500,
    total: 2000,
    amountPaid: 2000,
    change: null,
    items: [{ productId: anejoId, quantity: 1, unitPrice: 2500, taxRate: 0 }],
    payments: [{ method: 'CASH', amount: 2000 }],
  });

  const fixture5SaleId = await recreateSale(prisma, orgAId, userId, {
    saleNumber: 1005,
    customerId: null,
    subtotal: 5900,
    taxAmount: 1121,
    discountAmount: 0,
    total: 7021,
    amountPaid: 10000,
    change: 2979,
    items: [{ productId: arepaId, quantity: 1, unitPrice: 5900, taxRate: 19 }],
    payments: [{ method: 'CASH', amount: 10000 }],
  });

  const fixture6SaleId = await recreateSale(prisma, orgBId, userId, {
    saleNumber: 2001,
    customerId: customerB1Id,
    subtotal: 45000,
    taxAmount: 8550,
    discountAmount: 0,
    total: 53550,
    amountPaid: 53550,
    change: null,
    items: [{ productId: mochilaId, quantity: 1, unitPrice: 45000, taxRate: 19 }],
    payments: [{ method: 'TRANSFER', amount: 53550 }],
  });

  // ---- Generate baselines through the CURRENT SalesService builder ----
  const adminUser = {
    userId,
    email: FIXTURE_USER_EMAIL,
    organizationId: orgAId,
    role: 'ADMIN' as const,
    tokenVersion: 1,
    isSuperAdmin: false,
  };

  const fixtures: Array<{ key: string; saleId: string; organizationId: string }> = [
    { key: 'fixture-1-normal-cash-change', saleId: fixture1SaleId, organizationId: orgAId },
    { key: 'fixture-2-multipayment-cash-card', saleId: fixture2SaleId, organizationId: orgAId },
    { key: 'fixture-3-special-chars', saleId: fixture3SaleId, organizationId: orgAId },
    { key: 'fixture-4-zero-tax-discount', saleId: fixture4SaleId, organizationId: orgAId },
    { key: 'fixture-5-no-customer', saleId: fixture5SaleId, organizationId: orgAId },
    { key: 'fixture-6-long-header-footer-logo', saleId: fixture6SaleId, organizationId: orgBId },
  ];

  fs.mkdirSync(PDF_DIR, { recursive: true });

  const expected: Record<string, string> = {};
  const inputs: Record<string, unknown> = {};

  for (const fixture of fixtures) {
    let captured: Buffer | undefined;
    const stubResponse: StubResponse = {
      setHeader: () => undefined,
      send: (body: Buffer) => {
        captured = body;
      },
    };

    await salesService.generateReceipt(
      fixture.saleId,
      stubResponse as never,
      { ...adminUser, organizationId: fixture.organizationId },
    );

    if (!captured || captured.length === 0) {
      throw new Error(`Fixture ${fixture.key}: no PDF captured from generateReceipt`);
    }

    const pdfPath = path.join(PDF_DIR, `${fixture.key}.pdf`);
    fs.writeFileSync(pdfPath, captured);

    const extracted = await pdfParse(captured);
    const normalized = normalizeExtracted(extracted.text);
    if (normalized.length === 0) {
      throw new Error(`Fixture ${fixture.key}: extracted text is empty`);
    }
    expected[fixture.key] = normalized;

    // Capture the exact input shape the builder consumed (findOne + settings).
    const sale = await salesService.findOne(fixture.saleId, fixture.organizationId, {
      ...adminUser,
      organizationId: fixture.organizationId,
    });
    const settings = await settingsService.find(fixture.organizationId);
    inputs[fixture.key] = { sale, settings };

    console.log(`✅ ${fixture.key}: ${captured.length} bytes, ${normalized.length} chars extracted`);
  }

  const baselines = {
    _comment:
      'Golden baselines for the receipt PDF extraction gate. Regenerate with: npm run fixtures:receipts after intentional layout changes.',
    normalization: "pdf-parse text; replace /\\s+/g with ' '; trim",
    expected,
  };
  fs.writeFileSync(path.join(__dirname, 'baselines.json'), JSON.stringify(baselines, null, 2) + '\n');
  fs.writeFileSync(
    path.join(__dirname, 'fixture-inputs.json'),
    JSON.stringify(inputs, null, 2) + '\n',
  );

  console.log('\nBaselines written to backend/test/fixtures/receipts/');
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Fixture generation failed:', error);
  process.exitCode = 1;
});
