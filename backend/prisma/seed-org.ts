import { PrismaClient, Prisma, SupplierAccountType, CustomerSegment } from '@prisma/client';
import { faker } from '@faker-js/faker';
import { applySiteStockDelta, resolveDefaultSiteWithin } from '../src/inventory/site-stock';

const prisma = new PrismaClient();

// Email del owner que identifica la organización a sembrar.
const TARGET_EMAIL = 'santiagovillabona@meperpos.com';

// ─── Catalog definitions (deterministic, cost != sale to exercise reports) ───

interface CategoryDef {
  name: string;
  description: string;
  defaultTaxRate: number;
}

const CATEGORIES: CategoryDef[] = [
  { name: 'Bebidas', description: 'Bebidas frías y calientes', defaultTaxRate: 0 },
  { name: 'Alimentos', description: 'Alimentos y snacks', defaultTaxRate: 0 },
  { name: 'Limpieza', description: 'Productos de aseo y limpieza', defaultTaxRate: 0 },
  { name: 'Electrónica', description: 'Accesorios y electrónica', defaultTaxRate: 0 },
  { name: 'Papelería', description: 'Artículos de papelería y oficina', defaultTaxRate: 0 },
  { name: 'Aseo Personal', description: 'Cuidado e higiene personal', defaultTaxRate: 0 },
];

interface ProductDef {
  name: string;
  sku: string;
  category: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  taxable: boolean;
}

// costPrice siempre distinto de salePrice; márgenes variados para probar reports.
const PRODUCTS: ProductDef[] = [
  { name: 'Agua 500ml', sku: 'BEB-001', category: 'Bebidas', costPrice: 800, salePrice: 1500, stock: 120, minStock: 20, taxable: true },
  { name: 'Gaseosa 1.5L', sku: 'BEB-002', category: 'Bebidas', costPrice: 4300, salePrice: 7500, stock: 60, minStock: 15, taxable: true },
  { name: 'Café 500g', sku: 'ALI-001', category: 'Alimentos', costPrice: 12000, salePrice: 19900, stock: 45, minStock: 10, taxable: true },
  { name: 'Arroz 1kg', sku: 'ALI-002', category: 'Alimentos', costPrice: 3600, salePrice: 5200, stock: 80, minStock: 20, taxable: true },
  { name: 'Aceite 1L', sku: 'ALI-003', category: 'Alimentos', costPrice: 9800, salePrice: 14500, stock: 35, minStock: 8, taxable: true },
  { name: 'Leche 1L', sku: 'ALI-004', category: 'Alimentos', costPrice: 3800, salePrice: 5200, stock: 90, minStock: 25, taxable: true },
  { name: 'Detergente 1kg', sku: 'LIM-001', category: 'Limpieza', costPrice: 6800, salePrice: 9900, stock: 40, minStock: 10, taxable: true },
  { name: 'Jabón de baño', sku: 'LIM-002', category: 'Limpieza', costPrice: 2400, salePrice: 3900, stock: 110, minStock: 30, taxable: true },
  { name: 'Suavizante 3L', sku: 'LIM-003', category: 'Limpieza', costPrice: 10500, salePrice: 16900, stock: 25, minStock: 6, taxable: true },
  { name: 'Desinfectante 500ml', sku: 'LIM-004', category: 'Limpieza', costPrice: 3200, salePrice: 4800, stock: 55, minStock: 12, taxable: true },
  { name: 'Audífonos básicos', sku: 'ELEC-001', category: 'Electrónica', costPrice: 21000, salePrice: 39900, stock: 18, minStock: 4, taxable: true },
  { name: 'Cargador USB-C', sku: 'ELEC-002', category: 'Electrónica', costPrice: 14500, salePrice: 25900, stock: 22, minStock: 5, taxable: true },
  { name: 'Parlante Bluetooth', sku: 'ELEC-003', category: 'Electrónica', costPrice: 52000, salePrice: 89900, stock: 9, minStock: 3, taxable: true },
  { name: 'Mouse inalámbrico', sku: 'ELEC-004', category: 'Electrónica', costPrice: 24500, salePrice: 42900, stock: 15, minStock: 4, taxable: true },
  { name: 'Cuaderno 100h', sku: 'PAPEL-001', category: 'Papelería', costPrice: 4200, salePrice: 6900, stock: 140, minStock: 40, taxable: true },
  { name: 'Bolígrafo azul', sku: 'PAPEL-002', category: 'Papelería', costPrice: 900, salePrice: 1500, stock: 300, minStock: 60, taxable: true },
  { name: 'Resma papel 75g', sku: 'PAPEL-003', category: 'Papelería', costPrice: 17500, salePrice: 26500, stock: 30, minStock: 8, taxable: true },
  { name: 'Shampoo 750ml', sku: 'ASEO-001', category: 'Aseo Personal', costPrice: 12500, salePrice: 18900, stock: 48, minStock: 10, taxable: true },
  { name: 'Crema dental', sku: 'ASEO-002', category: 'Aseo Personal', costPrice: 5800, salePrice: 8900, stock: 75, minStock: 20, taxable: true },
  { name: 'Desodorante 150ml', sku: 'ASEO-003', category: 'Aseo Personal', costPrice: 7800, salePrice: 11900, stock: 52, minStock: 15, taxable: true },
];

interface CustomerDef {
  name: string;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
  segment: CustomerSegment;
}

const CUSTOMERS: CustomerDef[] = [
  { name: 'María González', documentNumber: '1023456789', email: 'maria.gonzalez@mail.com', phone: '3001234567', address: 'Calle 10 #20-30', segment: 'VIP' },
  { name: 'Carlos Pérez', documentNumber: '1045678901', email: 'carlos.perez@mail.com', phone: '3109876543', address: 'Cra 15 #45-10', segment: 'FREQUENT' },
  { name: 'Ana Rodríguez', documentNumber: '1098765432', email: 'ana.rodriguez@mail.com', phone: '3204567890', address: 'Av 30 #12-45', segment: 'OCCASIONAL' },
  { name: 'Luis Martínez', documentNumber: '1034567890', email: 'luis.martinez@mail.com', phone: '3156543210', address: 'Calle 5 #78-12', segment: 'FREQUENT' },
  { name: 'Laura Torres', documentNumber: '1012345678', email: 'laura.torres@mail.com', phone: '3201234567', address: 'Cra 8 #3-20', segment: 'VIP' },
  { name: 'Jorge Ramírez', documentNumber: '1029876543', email: 'jorge.ramirez@mail.com', phone: '3012345678', address: 'Calle 22 #4-9', segment: 'OCCASIONAL' },
  { name: 'Paola Mendoza', documentNumber: '1087654321', email: 'paola.mendoza@mail.com', phone: '3129876543', address: 'Av 45 #89-23', segment: 'INACTIVE' },
  { name: 'Andrés Castro', documentNumber: '1056789012', email: 'andres.castro@mail.com', phone: '3184567890', address: 'Calle 7 #15-33', segment: 'FREQUENT' },
];

interface SupplierDef {
  name: string;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
  contactName: string;
  bank: string;
  accountNumber: string;
  accountType: SupplierAccountType;
}

const SUPPLIERS: SupplierDef[] = [
  { name: 'Distribuidora Central S.A.S.', documentNumber: '900123456-1', email: 'ventas@central.com', phone: '6012345678', address: 'Zona Industrial Km 2', contactName: 'Pedro Gómez', bank: 'Bancolombia', accountNumber: '3012345678', accountType: 'CHECKING' },
  { name: 'Importadora Andina Ltda.', documentNumber: '900765432-2', email: 'contacto@andina.com', phone: '6018765432', address: 'Calle Principal 45', contactName: 'Sofía Ríos', bank: 'Banco de Bogotá', accountNumber: '4567890123', accountType: 'SAVINGS' },
  { name: 'Alimentos del Valle', documentNumber: '900321654-3', email: 'info@delvalle.com', phone: '6023456789', address: 'Autopista Sur 12', contactName: 'Ricardo Silva', bank: 'Davivienda', accountNumber: '9876543210', accountType: 'CHECKING' },
  { name: 'TecnoDistribuciones', documentNumber: '901543210-4', email: 'ventas@tecnodist.com', phone: '6045678901', address: 'Centro Comercial T3', contactName: 'Valentina Mora', bank: 'BBVA', accountNumber: '1122334455', accountType: 'SAVINGS' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

async function resolveOrganizationId(): Promise<string> {
  // 1) Identificador explícito (slug o id) gana sobre la inferencia por email.
  const explicit = process.env.SEED_ORG_SLUG || process.env.SEED_ORG_ID;
  if (explicit) {
    const byId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(explicit);
    const org = byId
      ? await prisma.organization.findUnique({ where: { id: explicit } })
      : await prisma.organization.findUnique({ where: { slug: explicit } });
    if (!org) {
      throw new Error(
        `❌ No se encontró la organización con ${byId ? 'id' : 'slug'} "${explicit}". Verificá el valor de SEED_ORG_SLUG/SEED_ORG_ID.`,
      );
    }
    return org.id;
  }

  // 2) Inferencia por email: tolera cualquier rol, priorizando dueño primario.
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) {
    throw new Error(
      `❌ No se encontró el usuario "${TARGET_EMAIL}". Crea el usuario o pasá SEED_ORG_SLUG/SEED_ORG_ID.`,
    );
  }

  const memberships = await prisma.organizationUser.findMany({
    where: { userId: user.id },
    orderBy: [{ isPrimaryOwner: 'desc' }, { role: 'desc' }],
  });

  const membership =
    memberships.find((m) => m.isPrimaryOwner) ?? memberships[0];

  if (!membership) {
    throw new Error(
      `❌ El usuario "${TARGET_EMAIL}" no pertenece a ninguna organización. Pasá SEED_ORG_SLUG/SEED_ORG_ID o vincularlo primero.`,
    );
  }

  return membership.organizationId;
}

// ─── Seed steps (idempotent via upsert on org-scoped uniques) ──────────────

async function seedCategories(orgId: string): Promise<Record<string, string>> {
  const byName: Record<string, string> = {};

  for (const cat of CATEGORIES) {
    const result = await prisma.category.upsert({
      where: { organizationId_name: { organizationId: orgId, name: cat.name } },
      update: {
        description: cat.description,
        defaultTaxRate: d(cat.defaultTaxRate),
      },
      create: {
        name: cat.name,
        description: cat.description,
        defaultTaxRate: d(cat.defaultTaxRate),
        active: true,
        organizationId: orgId,
      },
    });
    byName[cat.name] = result.id;
  }

  console.log(`  📁 ${Object.keys(byName).length} categorías aseguradas`);
  return byName;
}

async function seedProducts(orgId: string, categoryIds: Record<string, string>): Promise<void> {
  let created = 0;

  for (const p of PRODUCTS) {
    const categoryId = categoryIds[p.category];
    // The per-site ledger is the source of truth, so a re-seeded balance becomes a
    // signed delta at the tenant default site; inserting a new product keeps
    // writing only the aggregate, exactly as before (the trigger opens its row).
    await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { organizationId_sku: { organizationId: orgId, sku: p.sku } },
        select: { id: true, stock: true },
      });

      if (existing) {
        const stockDelta = p.stock - existing.stock;
        if (stockDelta !== 0) {
          const siteId = await resolveDefaultSiteWithin(tx, orgId);
          const applied = await applySiteStockDelta(tx, {
            organizationId: orgId,
            productId: existing.id,
            locationId: siteId,
            stockDelta,
            reservedDelta: 0,
          });
          if (!applied.applied) {
            throw new Error(
              `No se puede sembrar "${p.name}": la sede principal no puede absorber el ajuste de ${stockDelta} unidades.`,
            );
          }
        }

        await tx.product.update({
          where: { id: existing.id },
          data: {
            name: p.name,
            costPrice: d(p.costPrice),
            salePrice: d(p.salePrice),
            minStock: p.minStock,
            taxRate: d(p.taxable ? 19 : 0),
            taxable: p.taxable,
            categoryId,
            active: true,
          },
        });
      } else {
        await tx.product.create({
          data: {
            name: p.name,
            sku: p.sku,
            costPrice: d(p.costPrice),
            salePrice: d(p.salePrice),
            taxRate: d(p.taxable ? 19 : 0),
            taxable: p.taxable,
            stock: p.stock,
            minStock: p.minStock,
            active: true,
            categoryId,
            organizationId: orgId,
          },
        });
      }
    });
    created += 1;
  }

  console.log(`  📦 ${created} productos asegurados (costo ≠ venta)`);
}

async function seedCustomers(orgId: string): Promise<void> {
  let created = 0;

  for (const c of CUSTOMERS) {
    await prisma.customer.upsert({
      where: {
        organizationId_documentNumber: { organizationId: orgId, documentNumber: c.documentNumber },
      },
      update: {
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        segment: c.segment,
      },
      create: {
        name: c.name,
        documentType: 'CC',
        documentNumber: c.documentNumber,
        email: c.email,
        phone: c.phone,
        address: c.address,
        segment: c.segment,
        active: true,
        organizationId: orgId,
      },
    });
    created += 1;
  }

  console.log(`  👥 ${created} clientes asegurados`);
}

async function seedSuppliers(orgId: string): Promise<void> {
  let created = 0;

  for (const s of SUPPLIERS) {
    await prisma.supplier.upsert({
      where: {
        organizationId_documentNumber: { organizationId: orgId, documentNumber: s.documentNumber },
      },
      update: {
        name: s.name,
        email: s.email,
        phone: s.phone,
        address: s.address,
        contactName: s.contactName,
        bank: s.bank,
        accountNumber: s.accountNumber,
        accountType: s.accountType,
      },
      create: {
        name: s.name,
        documentNumber: s.documentNumber,
        email: s.email,
        phone: s.phone,
        address: s.address,
        contactName: s.contactName,
        bank: s.bank,
        accountNumber: s.accountNumber,
        accountType: s.accountType,
        active: true,
        organizationId: orgId,
      },
    });
    created += 1;
  }

  console.log(`  🏷️  ${created} proveedores asegurados`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Guard: the seed is multi-tenant and org-scoped (never touches other orgs),
  // but we still avoid accidental runs against a real base. In dev/test it runs
  // freely; elsewhere it requires an explicit opt-in.
  const nodeEnv = process.env.NODE_ENV;
  const isDevOrTest = nodeEnv === 'development' || nodeEnv === 'test';
  const allowNonDev = process.env.SEED_ALLOW_NON_DEV === 'true';

  if (!isDevOrTest && !allowNonDev) {
    console.error(
      `❌ Refusing to seed: NODE_ENV is "${nodeEnv || 'undefined'}". ` +
      'This org seed targets ONE organization only, but to run outside ' +
      'development/test set SEED_ALLOW_NON_DEV=true explicitly. Aborting.',
    );
    process.exit(1);
  }

  if (!isDevOrTest) {
    console.warn(
      '⚠️  SEED_ALLOW_NON_DEV=true — you are deliberately seeding outside ' +
      'development/test. Data is org-scoped by "' +
      TARGET_EMAIL +
      '", so other organizations are untouched.\n',
    );
  }

  console.log(`🌱 Seeding data for organization of "${TARGET_EMAIL}"...\n`);

  const orgId = await resolveOrganizationId();
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  console.log(`  🏢 Organización: ${org?.name ?? orgId} (slug: ${org?.slug ?? '?'})\n`);

  const categoryIds = await seedCategories(orgId);
  await seedProducts(orgId, categoryIds);
  await seedCustomers(orgId);
  await seedSuppliers(orgId);

  console.log('\n✅ Org seed completed successfully!');
  console.log('  - No se tocaron las organizaciones demo ni otros datos.');
  console.log('  - Idempotente: podés volver a ejecutarlo sin duplicar.');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding org data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
