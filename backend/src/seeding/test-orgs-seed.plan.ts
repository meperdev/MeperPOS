/**
 * Pure data plan for the two test organizations («Prueba PRO» and «Prueba
 * BASIC»).
 *
 * This module decides WHAT each organization contains and proves its internal
 * arithmetic (totals, payment sums, payroll balances, loan balances, unique
 * keys, plan limits). `prisma/seed-test-orgs.ts` decides WHEN and HOW those
 * rows are written. Keeping the plan pure means every invariant can be tested
 * without a database, which is the only regression net a seed script can have.
 *
 * The plan is deterministic for a given `now`: the same input always produces
 * the same rows, so a dry run describes exactly what an `--apply` would write.
 *
 * Plan breadth mirrors the real plans: PRO gets every section the product has
 * (two sites with per-site stock, a received stock transfer, an inventory loan,
 * a sent purchase order, payroll and loans), while BASIC stays inside
 * `PLAN_LIMITS.BASIC` and only carries the sections a small shop uses.
 */

import { PLAN_LIMITS } from '../plan-limits/plan-limits.constants';

export type PlanRole = 'ADMIN' | 'CASHIER' | 'INVENTORY_USER';

export type PlanPaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';
export type PlanProductType = 'PRODUCT' | 'SERVICE';
export type PlanPromotionType = 'PERCENTAGE' | 'FIXED_PRICE';
export type PlanCustomerSegment =
  | 'VIP'
  | 'FREQUENT'
  | 'OCCASIONAL'
  | 'INACTIVE';
export type PlanSupplierAccountType = 'SAVINGS' | 'CHECKING';
export type PlanPurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'PARTIAL_RECEIVED'
  | 'RECEIVED';
export type PlanSaleStatus = 'COMPLETED';
export type PlanEmployeeModality = 'FIXED' | 'BY_DAY' | 'OTHER';
export type PlanShiftKind = 'FULL_DAY' | 'PARTIAL_DAY';
export type PlanPayrollKind = 'SHIFT_GROUP' | 'FIXED_PERIOD';
export type PlanPayrollStatus = 'PENDING' | 'COMPLETED';
export type PlanLoanType = 'MONEY' | 'SERVICE';
export type PlanLoanStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type PlanLoanEventType = 'CREATED' | 'COLLECTED' | 'CLOSED';
export type PlanTaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';
export type PlanLocationType = 'STORE' | 'WAREHOUSE';
export type PlanTransferStatus = 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
export type PlanInventoryLoanStatus = 'OPEN' | 'CANCELLED' | 'CLOSED';

/** Both test organizations share one ADMIN membership per organization. */
export type TestOrgUserKey = 'admin';

export type TestOrgSlug = 'prueba-pro' | 'prueba-basic';

export interface TestOrgsSeedInput {
  now?: Date;
}

export interface TestOrgUserPlan {
  key: TestOrgUserKey;
  email: string;
  name: string;
  role: PlanRole;
  isPrimaryOwner: boolean;
}

export interface TestOrgCategoryPlan {
  name: string;
  description: string;
  taxable: boolean;
  defaultTaxRate: number;
}

export interface TestOrgProductPlan {
  sku: string;
  barcode: string;
  name: string;
  categoryName: string;
  description: string;
  type: PlanProductType;
  tracksStock: boolean;
  costPrice: number;
  salePrice: number;
  taxRate: number;
  taxable: boolean;
  stock: number;
  minStock: number;
  promotionType: PlanPromotionType | null;
  promotionValue: number | null;
  /** Stock before any seeded purchase order was received. */
  openingStock: number;
}

export interface TestOrgCustomerPlan {
  documentNumber: string;
  documentType: 'CC' | 'NIT';
  name: string;
  email: string;
  phone: string;
  address: string;
  segment: PlanCustomerSegment;
}

export interface TestOrgSupplierPlan {
  documentNumber: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  contactName: string;
  bank: string;
  accountNumber: string;
  accountType: PlanSupplierAccountType;
}

export interface TestOrgPurchaseOrderItemPlan {
  sku: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
}

export interface TestOrgPurchaseOrderPlan {
  key: string;
  notes: string;
  supplierKey: string;
  status: PlanPurchaseOrderStatus;
  createdAt: string;
  confirmedAt: string | null;
  receivedAt: string | null;
  /**
   * When the order was sent to its supplier. The writer freezes the document
   * snapshot with the same builder `POST /api/purchase-orders/:id/send` uses.
   */
  sent: { daysAgo: number; expectedDeliveryDaysAgo: number | null } | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  items: TestOrgPurchaseOrderItemPlan[];
}

export interface TestOrgSaleItemPlan {
  sku: string;
  quantity: number;
  unitPrice: number;
  costPriceSnapshot: number;
  taxRate: number;
  subtotal: number;
  total: number;
}

export interface TestOrgSalePaymentPlan {
  method: PlanPaymentMethod;
  amount: number;
}

export interface TestOrgSalePlan {
  saleNumber: number;
  createdAt: string;
  customerDocumentNumber: string | null;
  userKey: TestOrgUserKey;
  status: PlanSaleStatus;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  amountPaid: number;
  change: number;
  items: TestOrgSaleItemPlan[];
  payments: TestOrgSalePaymentPlan[];
}

export interface TestOrgExpensePaymentPlan {
  daysAgo: number;
  amount: number;
  method: PlanPaymentMethod;
}

export interface TestOrgExpensePlan {
  key: string;
  groupName: string;
  labelName: string;
  supplierKey: string | null;
  purchaseOrderKey: string | null;
  description: string;
  daysAgo: number;
  total: number;
  status: 'PAID' | 'PARTIAL';
  payments: TestOrgExpensePaymentPlan[];
}

export interface TestOrgEmployeeShiftPlan {
  date: string;
  kind: PlanShiftKind;
  amount: number;
  observation: string | null;
}

export interface TestOrgEmployeePlan {
  key: string;
  name: string;
  identification: string;
  phone: string;
  email: string;
  address: string;
  jobTitle: string;
  startDate: string;
  remunerationModality: PlanEmployeeModality;
  referenceAmount: number | null;
  active: boolean;
  shifts: TestOrgEmployeeShiftPlan[];
}

export interface TestOrgPayrollPaymentPlan {
  date: string;
  amount: number;
  method: PlanPaymentMethod;
}

export interface TestOrgPayrollPlan {
  key: string;
  employeeKey: string;
  kind: PlanPayrollKind;
  status: PlanPayrollStatus;
  version: number;
  shiftDates: string[];
  periodStart: string | null;
  periodEnd: string | null;
  periodAmount: number | null;
  payments: TestOrgPayrollPaymentPlan[];
  total: number;
}

export interface TestOrgLoanResult {
  type: PlanLoanType;
  status: PlanLoanStatus;
  collected: string;
  balance: string;
  paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
}

export interface TestOrgMoneyLoanEventPlan {
  type: PlanLoanEventType;
  createdAt: string;
  amount: number | null;
  method: PlanPaymentMethod | null;
  reason: string;
  requestKey: string | null;
  requestPayload: Record<string, unknown> | null;
  result: TestOrgLoanResult | null;
}

export interface TestOrgMoneyLoanPlan {
  key: string;
  type: PlanLoanType;
  amount: number;
  issuedAt: string;
  dueAt: string | null;
  reason: string;
  counterparty:
    | { kind: 'customer'; documentNumber: string }
    | { kind: 'supplier'; documentNumber: string }
    | { kind: 'user'; userKey: TestOrgUserKey };
  status: PlanLoanStatus;
  version: number;
  events: TestOrgMoneyLoanEventPlan[];
}

export interface TestOrgInventoryLoanItemPlan {
  sku: string;
  quantity: number;
}

export interface TestOrgInventoryLoanEventPlan {
  type: 'CREATED';
  daysAgo: number;
}

export interface TestOrgInventoryLoanPlan {
  key: string;
  status: PlanInventoryLoanStatus;
  customerDocumentNumber: string;
  createdDaysAgo: number;
  items: TestOrgInventoryLoanItemPlan[];
  events: TestOrgInventoryLoanEventPlan[];
}

export interface TestOrgStockTransferItemPlan {
  sku: string;
  quantity: number;
}

export interface TestOrgStockTransferPlan {
  key: string;
  /** Consecutive per organization; the writer also recovers the counter. */
  number: number;
  fromLocationName: string;
  toLocationName: string;
  status: PlanTransferStatus;
  notes: string | null;
  createdDaysAgo: number;
  receivedDaysAgo: number | null;
  items: TestOrgStockTransferItemPlan[];
}

/** Opening per-site balance the seed moves off the default site. */
export interface TestOrgSiteStockPlan {
  sku: string;
  locationName: string;
  quantity: number;
}

export interface TestOrgTaskEventPlan {
  type: 'CREATED' | 'STATUS_CHANGED';
  fromStatus: PlanTaskStatus | null;
  toStatus: PlanTaskStatus;
  note: string | null;
  daysAgo: number;
}

export interface TestOrgTaskPlan {
  key: string;
  title: string;
  description: string;
  status: PlanTaskStatus;
  assignedTo: TestOrgUserKey;
  dueInDays: number | null;
  events: TestOrgTaskEventPlan[];
}

export interface TestOrgLocationPlan {
  name: string;
  type: PlanLocationType;
  isDefault: boolean;
  address: string;
  phone: string;
}

/**
 * `currency`, `locale` and `timezone` are application constants
 * (`common/constants/locale.constants.ts`), and the receipt prefix is the SALE
 * sequence prefix. The persisted blob therefore carries only the keys the
 * settings service reads: the two invoicing strings and the purchase order
 * template.
 */
export interface TestOrgSettingsPlan {
  printHeader: string;
  printFooter: string;
  purchaseOrderTemplate: {
    deliveryAddress: string;
    paymentTerms: string;
    terms: string;
    footer: string;
  };
}

export interface TestOrgOrganizationPlan {
  name: string;
  slug: TestOrgSlug;
  plan: 'PRO' | 'BASIC';
  taxId: string;
  phone: string;
  address: string;
  status: 'ACTIVE';
  billingStatus: 'PAID';
  settings: TestOrgSettingsPlan;
  sequences: { type: 'SALE' | 'PO' | 'TRANSFER'; prefix: string | null }[];
  locations: TestOrgLocationPlan[];
  cashRegisters: string[];
}

export interface TestOrgPlan {
  organization: TestOrgOrganizationPlan;
  users: TestOrgUserPlan[];
  categories: TestOrgCategoryPlan[];
  products: TestOrgProductPlan[];
  customers: TestOrgCustomerPlan[];
  suppliers: TestOrgSupplierPlan[];
  purchaseOrders: TestOrgPurchaseOrderPlan[];
  sales: TestOrgSalePlan[];
  expenses: TestOrgExpensePlan[];
  employees: TestOrgEmployeePlan[];
  payroll: TestOrgPayrollPlan[];
  moneyLoans: TestOrgMoneyLoanPlan[];
  inventoryLoans: TestOrgInventoryLoanPlan[];
  stockTransfers: TestOrgStockTransferPlan[];
  siteStock: TestOrgSiteStockPlan[];
  tasks: TestOrgTaskPlan[];
}

export interface TestOrgsSeedPlan {
  organizations: TestOrgPlan[];
}

// ─── Fixed identities ──────────────────────────────────────────────────────

/**
 * Both identities are fixed, not configurable: the guard that refuses a slug
 * already belonging to another organization only has meaning if the seed always
 * targets the same two slugs.
 */
export const TEST_ORGS = {
  pro: {
    name: 'Prueba PRO',
    slug: 'prueba-pro' as const,
    adminEmail: 'admin.pro@meperpos.test',
    adminName: 'Administrador Prueba PRO',
    staffDomain: 'prueba-pro.test',
    taxId: '901112223-4',
    phone: '6015550101',
    address: 'Calle 100 #15-20, Bogotá',
  },
  basic: {
    name: 'Prueba BASIC',
    slug: 'prueba-basic' as const,
    adminEmail: 'admin.basic@meperpos.test',
    adminName: 'Administrador Prueba BASIC',
    staffDomain: 'prueba-basic.test',
    taxId: '901445556-7',
    phone: '6044440102',
    address: 'Cra 43A #1-50, Medellín',
  },
} as const;

// ─── Money and date helpers ────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

function moneyText(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error('Invalid monetary amount in the test-orgs plan');
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDateTime(date: Date): string {
  return date.toISOString();
}

/**
 * Small deterministic PRNG (mulberry32). The seed keeps generated sales stable
 * between a dry run and the apply run, and between two apply runs.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function pickDistinct<T>(
  items: readonly T[],
  count: number,
  random: () => number,
): T[] {
  const pool = [...items];
  const picked: T[] = [];
  for (let index = 0; index < count && pool.length > 0; index += 1) {
    const position = Math.floor(random() * pool.length);
    picked.push(pool[position]);
    pool.splice(position, 1);
  }
  return picked;
}

// ─── Static catalog (Spanish, es-CO) ───────────────────────────────────────

const CATEGORY_CATALOG: TestOrgCategoryPlan[] = [
  {
    name: 'Bebidas',
    description: 'Bebidas frías y calientes',
    taxable: true,
    defaultTaxRate: 19,
  },
  {
    name: 'Alimentos',
    description: 'Alimentos de la canasta básica',
    taxable: false,
    defaultTaxRate: 0,
  },
  {
    name: 'Aseo',
    description: 'Productos de aseo y limpieza',
    taxable: true,
    defaultTaxRate: 19,
  },
  {
    name: 'Papelería',
    description: 'Artículos de papelería y oficina',
    taxable: true,
    defaultTaxRate: 19,
  },
  {
    name: 'Electrónica',
    description: 'Accesorios y electrónica de consumo',
    taxable: true,
    defaultTaxRate: 19,
  },
  {
    name: 'Servicios',
    description: 'Servicios prestados en el local',
    taxable: true,
    defaultTaxRate: 19,
  },
];

interface ProductDefinition {
  sku: string;
  barcode: string;
  name: string;
  categoryName: string;
  type: PlanProductType;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  taxable: boolean;
  promotionType?: PlanPromotionType;
  promotionValue?: number;
}

const PRODUCT_CATALOG: ProductDefinition[] = [
  {
    sku: 'BEB-001',
    barcode: '7701000000011',
    name: 'Agua 500 ml',
    categoryName: 'Bebidas',
    type: 'PRODUCT',
    costPrice: 800,
    salePrice: 1500,
    stock: 120,
    minStock: 20,
    taxable: true,
  },
  {
    sku: 'BEB-002',
    barcode: '7701000000028',
    name: 'Gaseosa 1.5 L',
    categoryName: 'Bebidas',
    type: 'PRODUCT',
    costPrice: 4300,
    salePrice: 7500,
    stock: 60,
    minStock: 12,
    taxable: true,
    promotionType: 'FIXED_PRICE',
    promotionValue: 6900,
  },
  {
    sku: 'BEB-003',
    barcode: '7701000000035',
    name: 'Café molido 500 g',
    categoryName: 'Bebidas',
    type: 'PRODUCT',
    costPrice: 12000,
    salePrice: 19900,
    stock: 8,
    minStock: 8,
    taxable: true,
  },
  {
    sku: 'BEB-004',
    barcode: '7701000000042',
    name: 'Jugo natural 1 L',
    categoryName: 'Bebidas',
    type: 'PRODUCT',
    costPrice: 3500,
    salePrice: 6200,
    stock: 45,
    minStock: 10,
    taxable: true,
  },
  {
    sku: 'BEB-005',
    barcode: '7701000000059',
    name: 'Agua con gas 600 ml',
    categoryName: 'Bebidas',
    type: 'PRODUCT',
    costPrice: 1100,
    salePrice: 2200,
    stock: 90,
    minStock: 20,
    taxable: true,
  },
  {
    sku: 'ALI-001',
    barcode: '7702000000010',
    name: 'Arroz 1 kg',
    categoryName: 'Alimentos',
    type: 'PRODUCT',
    costPrice: 3600,
    salePrice: 5200,
    stock: 80,
    minStock: 20,
    taxable: false,
  },
  {
    sku: 'ALI-002',
    barcode: '7702000000027',
    name: 'Aceite 1 L',
    categoryName: 'Alimentos',
    type: 'PRODUCT',
    costPrice: 9800,
    salePrice: 14500,
    stock: 35,
    minStock: 8,
    taxable: false,
  },
  {
    sku: 'ALI-003',
    barcode: '7702000000034',
    name: 'Leche entera 1 L',
    categoryName: 'Alimentos',
    type: 'PRODUCT',
    costPrice: 3800,
    salePrice: 5200,
    stock: 90,
    minStock: 25,
    taxable: false,
  },
  {
    sku: 'ALI-004',
    barcode: '7702000000041',
    name: 'Huevos x12',
    categoryName: 'Alimentos',
    type: 'PRODUCT',
    costPrice: 9000,
    salePrice: 13500,
    stock: 40,
    minStock: 10,
    taxable: false,
  },
  {
    sku: 'ALI-005',
    barcode: '7702000000058',
    name: 'Panela 500 g',
    categoryName: 'Alimentos',
    type: 'PRODUCT',
    costPrice: 2400,
    salePrice: 3900,
    stock: 55,
    minStock: 12,
    taxable: false,
  },
  {
    sku: 'ALI-006',
    barcode: '7702000000065',
    name: 'Lentejas 500 g',
    categoryName: 'Alimentos',
    type: 'PRODUCT',
    costPrice: 3100,
    salePrice: 4800,
    stock: 30,
    minStock: 8,
    taxable: false,
  },
  {
    sku: 'ASE-001',
    barcode: '7703000000019',
    name: 'Detergente 1 kg',
    categoryName: 'Aseo',
    type: 'PRODUCT',
    costPrice: 6800,
    salePrice: 9900,
    stock: 40,
    minStock: 10,
    taxable: true,
  },
  {
    sku: 'ASE-002',
    barcode: '7703000000026',
    name: 'Jabón de baño',
    categoryName: 'Aseo',
    type: 'PRODUCT',
    costPrice: 2400,
    salePrice: 3900,
    stock: 110,
    minStock: 25,
    taxable: true,
  },
  {
    sku: 'ASE-003',
    barcode: '7703000000033',
    name: 'Suavizante 3 L',
    categoryName: 'Aseo',
    type: 'PRODUCT',
    costPrice: 10500,
    salePrice: 16900,
    stock: 6,
    minStock: 6,
    taxable: true,
  },
  {
    sku: 'ASE-004',
    barcode: '7703000000040',
    name: 'Limpiavidrios 500 ml',
    categoryName: 'Aseo',
    type: 'PRODUCT',
    costPrice: 4200,
    salePrice: 6900,
    stock: 26,
    minStock: 8,
    taxable: true,
  },
  {
    sku: 'PAP-001',
    barcode: '7704000000018',
    name: 'Cuaderno 100 hojas',
    categoryName: 'Papelería',
    type: 'PRODUCT',
    costPrice: 4200,
    salePrice: 6900,
    stock: 70,
    minStock: 20,
    taxable: true,
  },
  {
    sku: 'PAP-002',
    barcode: '7704000000025',
    name: 'Bolígrafo azul',
    categoryName: 'Papelería',
    type: 'PRODUCT',
    costPrice: 900,
    salePrice: 1500,
    stock: 150,
    minStock: 40,
    taxable: true,
  },
  {
    sku: 'PAP-003',
    barcode: '7704000000032',
    name: 'Resma papel 75 g',
    categoryName: 'Papelería',
    type: 'PRODUCT',
    costPrice: 17500,
    salePrice: 26500,
    stock: 22,
    minStock: 8,
    taxable: true,
  },
  {
    sku: 'PAP-004',
    barcode: '7704000000049',
    name: 'Marcador permanente',
    categoryName: 'Papelería',
    type: 'PRODUCT',
    costPrice: 1800,
    salePrice: 3200,
    stock: 60,
    minStock: 15,
    taxable: true,
  },
  {
    sku: 'ELE-001',
    barcode: '7705000000017',
    name: 'Audífonos básicos',
    categoryName: 'Electrónica',
    type: 'PRODUCT',
    costPrice: 21000,
    salePrice: 39900,
    stock: 14,
    minStock: 4,
    taxable: true,
  },
  {
    sku: 'ELE-002',
    barcode: '7705000000024',
    name: 'Cargador USB-C',
    categoryName: 'Electrónica',
    type: 'PRODUCT',
    costPrice: 14500,
    salePrice: 25900,
    stock: 20,
    minStock: 5,
    taxable: true,
  },
  {
    sku: 'ELE-003',
    barcode: '7705000000031',
    name: 'Parlante Bluetooth',
    categoryName: 'Electrónica',
    type: 'PRODUCT',
    costPrice: 52000,
    salePrice: 89900,
    stock: 3,
    minStock: 3,
    taxable: true,
    promotionType: 'PERCENTAGE',
    promotionValue: 10,
  },
  {
    sku: 'ELE-004',
    barcode: '7705000000048',
    name: 'Mouse inalámbrico',
    categoryName: 'Electrónica',
    type: 'PRODUCT',
    costPrice: 24500,
    salePrice: 42900,
    stock: 10,
    minStock: 4,
    taxable: true,
  },
  {
    sku: 'ELE-005',
    barcode: '7705000000055',
    name: 'Pilas AA x4',
    categoryName: 'Electrónica',
    type: 'PRODUCT',
    costPrice: 5200,
    salePrice: 8900,
    stock: 48,
    minStock: 12,
    taxable: true,
  },
  {
    sku: 'SRV-001',
    barcode: '7706000000016',
    name: 'Instalación de accesorio',
    categoryName: 'Servicios',
    type: 'SERVICE',
    costPrice: 0,
    salePrice: 25000,
    stock: 0,
    minStock: 0,
    taxable: true,
  },
  {
    sku: 'SRV-002',
    barcode: '7706000000023',
    name: 'Mantenimiento preventivo',
    categoryName: 'Servicios',
    type: 'SERVICE',
    costPrice: 0,
    salePrice: 45000,
    stock: 0,
    minStock: 0,
    taxable: true,
  },
];

/** A small shop keeps a short catalog so BASIC stays inside its limits. */
const BASIC_SKUS = [
  'BEB-001',
  'BEB-002',
  'BEB-003',
  'ALI-001',
  'ALI-002',
  'ALI-003',
  'ASE-001',
  'ASE-002',
  'PAP-002',
  'ELE-005',
  'SRV-001',
  'SRV-002',
];

const CUSTOMER_CATALOG: TestOrgCustomerPlan[] = [
  {
    documentNumber: '1023456789',
    documentType: 'CC',
    name: 'María González',
    email: 'maria.gonzalez@mail.com',
    phone: '3001234567',
    address: 'Calle 10 #20-30',
    segment: 'VIP',
  },
  {
    documentNumber: '1045678901',
    documentType: 'CC',
    name: 'Carlos Pérez',
    email: 'carlos.perez@mail.com',
    phone: '3109876543',
    address: 'Cra 15 #45-10',
    segment: 'FREQUENT',
  },
  {
    documentNumber: '1098765432',
    documentType: 'CC',
    name: 'Ana Rodríguez',
    email: 'ana.rodriguez@mail.com',
    phone: '3204567890',
    address: 'Av 30 #12-45',
    segment: 'OCCASIONAL',
  },
  {
    documentNumber: '1034567890',
    documentType: 'CC',
    name: 'Luis Martínez',
    email: 'luis.martinez@mail.com',
    phone: '3156543210',
    address: 'Calle 5 #78-12',
    segment: 'FREQUENT',
  },
  {
    documentNumber: '1012345678',
    documentType: 'CC',
    name: 'Laura Torres',
    email: 'laura.torres@mail.com',
    phone: '3201234567',
    address: 'Cra 8 #3-20',
    segment: 'VIP',
  },
  {
    documentNumber: '1029876543',
    documentType: 'CC',
    name: 'Jorge Ramírez',
    email: 'jorge.ramirez@mail.com',
    phone: '3012345678',
    address: 'Calle 22 #4-9',
    segment: 'OCCASIONAL',
  },
  {
    documentNumber: '1087654321',
    documentType: 'CC',
    name: 'Paola Mendoza',
    email: 'paola.mendoza@mail.com',
    phone: '3129876543',
    address: 'Av 45 #89-23',
    segment: 'INACTIVE',
  },
  {
    documentNumber: '1056789012',
    documentType: 'CC',
    name: 'Andrés Castro',
    email: 'andres.castro@mail.com',
    phone: '3184567890',
    address: 'Calle 7 #15-33',
    segment: 'FREQUENT',
  },
  {
    documentNumber: '1067890123',
    documentType: 'CC',
    name: 'Diana Salazar',
    email: 'diana.salazar@mail.com',
    phone: '3112345678',
    address: 'Cra 19 #8-44',
    segment: 'OCCASIONAL',
  },
  {
    documentNumber: '1078901234',
    documentType: 'CC',
    name: 'Óscar Villalba',
    email: 'oscar.villalba@mail.com',
    phone: '3145678901',
    address: 'Calle 33 #21-07',
    segment: 'VIP',
  },
];

const SUPPLIER_CATALOG: TestOrgSupplierPlan[] = [
  {
    documentNumber: '900123456-1',
    name: 'Distribuidora Central S.A.S.',
    email: 'ventas@central.com',
    phone: '6012345678',
    address: 'Zona Industrial Km 2',
    contactName: 'Pedro Gómez',
    bank: 'Bancolombia',
    accountNumber: '3012345678',
    accountType: 'CHECKING',
  },
  {
    documentNumber: '900765432-2',
    name: 'Importadora Andina Ltda.',
    email: 'contacto@andina.com',
    phone: '6018765432',
    address: 'Calle Principal 45',
    contactName: 'Sofía Ríos',
    bank: 'Banco de Bogotá',
    accountNumber: '4567890123',
    accountType: 'SAVINGS',
  },
  {
    documentNumber: '900321654-3',
    name: 'Alimentos del Valle',
    email: 'info@delvalle.com',
    phone: '6023456789',
    address: 'Autopista Sur 12',
    contactName: 'Ricardo Silva',
    bank: 'Davivienda',
    accountNumber: '9876543210',
    accountType: 'CHECKING',
  },
  {
    documentNumber: '901543210-4',
    name: 'TecnoDistribuciones',
    email: 'ventas@tecnodist.com',
    phone: '6045678901',
    address: 'Centro Comercial T3',
    contactName: 'Valentina Mora',
    bank: 'BBVA',
    accountNumber: '1122334455',
    accountType: 'SAVINGS',
  },
];

// ─── Builders ──────────────────────────────────────────────────────────────

function buildUsers(
  identity: (typeof TEST_ORGS)['pro'] | (typeof TEST_ORGS)['basic'],
): TestOrgUserPlan[] {
  return [
    {
      // The owner is identified by isPrimaryOwner, not by a role: OWNER was
      // retired and collapsed into ADMIN (migration 20261127130000).
      key: 'admin',
      email: identity.adminEmail,
      name: identity.adminName,
      role: 'ADMIN',
      isPrimaryOwner: true,
    },
  ];
}

function selectProducts(plan: 'PRO' | 'BASIC'): ProductDefinition[] {
  if (plan === 'PRO') return PRODUCT_CATALOG;
  return PRODUCT_CATALOG.filter((definition) =>
    BASIC_SKUS.includes(definition.sku),
  );
}

function buildProducts(plan: 'PRO' | 'BASIC'): TestOrgProductPlan[] {
  return selectProducts(plan).map((definition) => ({
    sku: definition.sku,
    barcode: definition.barcode,
    name: definition.name,
    categoryName: definition.categoryName,
    description:
      definition.type === 'SERVICE'
        ? 'Servicio prestado en el local'
        : 'Producto de demostración para la organización de prueba',
    type: definition.type,
    tracksStock: definition.type === 'PRODUCT',
    costPrice: definition.costPrice,
    salePrice: definition.salePrice,
    taxRate: definition.taxable ? 19 : 0,
    taxable: definition.taxable,
    stock: definition.stock,
    minStock: definition.minStock,
    promotionType: definition.promotionType ?? null,
    promotionValue: definition.promotionValue ?? null,
    // Replaced once purchase orders know how many units were received.
    openingStock: definition.stock,
  }));
}

/** Categories are derived from the products, so the catalog never dangles. */
function buildCategories(
  products: TestOrgProductPlan[],
): TestOrgCategoryPlan[] {
  const used = new Set(products.map((product) => product.categoryName));
  return CATEGORY_CATALOG.filter((category) => used.has(category.name));
}

interface PurchaseOrderDefinition {
  key: string;
  notes: string;
  supplierDocument: string;
  status: PlanPurchaseOrderStatus;
  daysAgo: number;
  confirmedDaysAgo: number | null;
  receivedDaysAgo: number | null;
  sentDaysAgo: number | null;
  lines: { sku: string; qtyOrdered: number; qtyReceived: number }[];
}

function purchaseOrderDefinitions(
  plan: 'PRO' | 'BASIC',
): PurchaseOrderDefinition[] {
  if (plan === 'BASIC') {
    return [
      {
        key: 'draft',
        notes: '[prueba] Reposición semanal de bebidas',
        supplierDocument: '900123456-1',
        status: 'DRAFT',
        daysAgo: 2,
        confirmedDaysAgo: null,
        receivedDaysAgo: null,
        sentDaysAgo: null,
        lines: [
          { sku: 'BEB-001', qtyOrdered: 24, qtyReceived: 0 },
          { sku: 'BEB-002', qtyOrdered: 12, qtyReceived: 0 },
        ],
      },
      {
        key: 'received',
        notes: '[prueba] Compra de aseo y papelería',
        supplierDocument: '900765432-2',
        status: 'RECEIVED',
        daysAgo: 10,
        confirmedDaysAgo: 9,
        receivedDaysAgo: 8,
        sentDaysAgo: null,
        lines: [
          { sku: 'ASE-002', qtyOrdered: 12, qtyReceived: 12 },
          { sku: 'PAP-002', qtyOrdered: 20, qtyReceived: 20 },
        ],
      },
    ];
  }

  return [
    {
      key: 'draft',
      notes: '[prueba] Reposición de bebidas',
      supplierDocument: '900123456-1',
      status: 'DRAFT',
      daysAgo: 3,
      confirmedDaysAgo: null,
      receivedDaysAgo: null,
      sentDaysAgo: null,
      lines: [
        { sku: 'BEB-001', qtyOrdered: 24, qtyReceived: 0 },
        { sku: 'BEB-004', qtyOrdered: 18, qtyReceived: 0 },
      ],
    },
    {
      // The one sent order: confirmed, sent and still awaiting delivery.
      key: 'pending',
      notes: '[prueba] Pedido de aseo mensual',
      supplierDocument: '900765432-2',
      status: 'PENDING',
      daysAgo: 6,
      confirmedDaysAgo: 5,
      receivedDaysAgo: null,
      sentDaysAgo: 5,
      lines: [
        { sku: 'ASE-002', qtyOrdered: 30, qtyReceived: 0 },
        { sku: 'ASE-004', qtyOrdered: 12, qtyReceived: 0 },
      ],
    },
    {
      key: 'partial',
      notes: '[prueba] Pedido parcial de alimentos',
      supplierDocument: '900321654-3',
      status: 'PARTIAL_RECEIVED',
      daysAgo: 9,
      confirmedDaysAgo: 8,
      receivedDaysAgo: 7,
      sentDaysAgo: null,
      lines: [
        { sku: 'ALI-003', qtyOrdered: 24, qtyReceived: 24 },
        { sku: 'ALI-004', qtyOrdered: 20, qtyReceived: 8 },
      ],
    },
    {
      key: 'received',
      notes: '[prueba] Compra de electrónica',
      supplierDocument: '901543210-4',
      status: 'RECEIVED',
      daysAgo: 12,
      confirmedDaysAgo: 11,
      receivedDaysAgo: 10,
      sentDaysAgo: null,
      lines: [
        { sku: 'ELE-002', qtyOrdered: 8, qtyReceived: 8 },
        { sku: 'ELE-005', qtyOrdered: 20, qtyReceived: 20 },
      ],
    },
  ];
}

function buildPurchaseOrders(
  products: TestOrgProductPlan[],
  suppliers: TestOrgSupplierPlan[],
  plan: 'PRO' | 'BASIC',
  now: Date,
): TestOrgPurchaseOrderPlan[] {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const supplierByDocument = new Map(
    suppliers.map((supplier) => [supplier.documentNumber, supplier]),
  );

  const orders = purchaseOrderDefinitions(plan).map(
    (definition): TestOrgPurchaseOrderPlan => {
      const supplier = supplierByDocument.get(definition.supplierDocument);
      if (!supplier) {
        throw new Error(`Unknown supplier ${definition.supplierDocument}`);
      }

      const items = definition.lines.map(
        (line): TestOrgPurchaseOrderItemPlan => {
          const product = bySku.get(line.sku);
          if (!product) throw new Error(`Unknown product ${line.sku}`);
          if (product.type !== 'PRODUCT') {
            throw new Error(`Service ${line.sku} cannot be purchased`);
          }
          const subtotal = round2(product.costPrice * line.qtyOrdered);
          const taxAmount = round2(subtotal * (product.taxRate / 100));
          return {
            sku: line.sku,
            qtyOrdered: line.qtyOrdered,
            qtyReceived: line.qtyReceived,
            unitCost: product.costPrice,
            taxRate: product.taxRate,
            subtotal,
            taxAmount,
          };
        },
      );

      const subtotal = round2(
        items.reduce((sum, item) => sum + item.subtotal, 0),
      );
      const taxAmount = round2(
        items.reduce((sum, item) => sum + item.taxAmount, 0),
      );

      return {
        key: definition.key,
        notes: definition.notes,
        supplierKey: supplier.documentNumber,
        status: definition.status,
        createdAt: isoDateTime(addDays(now, -definition.daysAgo)),
        confirmedAt:
          definition.confirmedDaysAgo === null
            ? null
            : isoDateTime(addDays(now, -definition.confirmedDaysAgo)),
        receivedAt:
          definition.receivedDaysAgo === null
            ? null
            : isoDateTime(addDays(now, -definition.receivedDaysAgo)),
        sent:
          definition.sentDaysAgo === null
            ? null
            : {
                daysAgo: definition.sentDaysAgo,
                expectedDeliveryDaysAgo: definition.receivedDaysAgo ?? -7,
              },
        subtotal,
        taxAmount,
        total: round2(subtotal + taxAmount),
        items,
      };
    },
  );

  // The opening stock of every product must cover what the seeded orders
  // received, so the movement chain (opening -> purchase) never goes negative.
  const receivedBySku = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.qtyReceived > 0) {
        receivedBySku.set(
          item.sku,
          (receivedBySku.get(item.sku) ?? 0) + item.qtyReceived,
        );
      }
    }
  }
  for (const product of products) {
    product.openingStock =
      product.stock - (receivedBySku.get(product.sku) ?? 0);
    if (product.openingStock < 0) {
      throw new Error(
        `Product ${product.sku} stock is lower than its received purchase quantity`,
      );
    }
  }

  return orders;
}

function effectiveSalePrice(product: TestOrgProductPlan): number {
  if (
    product.promotionType === 'PERCENTAGE' &&
    product.promotionValue !== null
  ) {
    return round2(product.salePrice * (1 - product.promotionValue / 100));
  }
  if (
    product.promotionType === 'FIXED_PRICE' &&
    product.promotionValue !== null
  ) {
    return round2(product.promotionValue);
  }
  return product.salePrice;
}

interface SalesWindow {
  seed: number;
  days: number;
}

function buildSales(
  products: TestOrgProductPlan[],
  customers: TestOrgCustomerPlan[],
  now: Date,
  asOf: Date,
  window: SalesWindow,
): TestOrgSalePlan[] {
  const random = createRandom(window.seed);
  const sellable = products.filter(
    (product) => product.tracksStock || product.type === 'SERVICE',
  );
  const sales: TestOrgSalePlan[] = [];
  let saleNumber = 1;

  for (let daysAgo = window.days - 1; daysAgo >= 0; daysAgo -= 1) {
    const day = addDays(now, -daysAgo);
    const weekday = day.getUTCDay();
    let salesToday = 2 + Math.floor(random() * 2);
    if (weekday === 0) salesToday = Math.max(1, salesToday - 1);
    if (weekday === 6) salesToday += 1;

    for (let index = 0; index < salesToday; index += 1) {
      const hour = 8 + Math.floor(random() * 12);
      const minute = Math.floor(random() * 60);
      const createdAt = new Date(
        Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate(),
          hour + 5,
          minute,
        ),
      );
      if (createdAt.getTime() > asOf.getTime()) continue;

      const lineCount = 1 + Math.floor(random() * 3);
      const selected = pickDistinct(sellable, lineCount, random);
      const items: TestOrgSaleItemPlan[] = selected.map((product) => {
        const quantity =
          product.type === 'SERVICE' ? 1 : 1 + Math.floor(random() * 3);
        const unitPrice = effectiveSalePrice(product);
        const subtotal = round2(unitPrice * quantity);
        const taxAmount = round2(subtotal * (product.taxRate / 100));
        return {
          sku: product.sku,
          quantity,
          unitPrice,
          costPriceSnapshot: product.costPrice,
          taxRate: product.taxRate,
          subtotal,
          total: round2(subtotal + taxAmount),
        };
      });

      const subtotal = round2(
        items.reduce((sum, item) => sum + item.subtotal, 0),
      );
      const taxAmount = round2(
        items.reduce((sum, item) => sum + item.total - item.subtotal, 0),
      );
      const total = round2(subtotal + taxAmount);
      const customer = random() < 0.6 ? pickOne(customers, random) : null;
      const paymentRoll = random();
      const method: PlanPaymentMethod =
        paymentRoll < 0.5 ? 'CASH' : paymentRoll < 0.75 ? 'CARD' : 'TRANSFER';

      let payments: TestOrgSalePaymentPlan[];
      let amountPaid: number;
      if (method === 'CASH') {
        amountPaid = Math.ceil(total / 100) * 100;
        payments = [{ method: 'CASH', amount: amountPaid }];
      } else if (method === 'CARD' && random() < 0.2) {
        const cashPart = round2(total * 0.6);
        payments = [
          { method: 'CASH', amount: cashPart },
          { method: 'CARD', amount: round2(total - cashPart) },
        ];
        amountPaid = total;
      } else {
        amountPaid = total;
        payments = [{ method, amount: total }];
      }

      sales.push({
        saleNumber,
        createdAt: isoDateTime(createdAt),
        customerDocumentNumber: customer?.documentNumber ?? null,
        userKey: 'admin',
        status: 'COMPLETED',
        subtotal,
        taxAmount,
        discountAmount: 0,
        total,
        amountPaid,
        change: round2(amountPaid - total),
        items,
        payments,
      });
      saleNumber += 1;
    }
  }

  return sales;
}

function buildExpenses(
  suppliers: TestOrgSupplierPlan[],
  purchaseOrders: TestOrgPurchaseOrderPlan[],
  plan: 'PRO' | 'BASIC',
): TestOrgExpensePlan[] {
  const receivedOrder = purchaseOrders.find(
    (order) => order.status === 'RECEIVED',
  );
  if (!receivedOrder) throw new Error('Missing received purchase order');

  const expense = (
    key: string,
    groupName: string,
    labelName: string,
    description: string,
    daysAgo: number,
    total: number,
    status: 'PAID' | 'PARTIAL',
    payments: TestOrgExpensePaymentPlan[],
    supplierKey: string | null = null,
    purchaseOrderKey: string | null = null,
  ): TestOrgExpensePlan => ({
    key,
    groupName,
    labelName,
    supplierKey,
    purchaseOrderKey,
    description,
    daysAgo,
    total,
    status,
    payments,
  });

  const shared = [
    expense(
      'rent',
      'Gastos del local',
      'Arriendo',
      'Arriendo del local comercial',
      50,
      1800000,
      'PAID',
      [{ daysAgo: 50, amount: 1800000, method: 'TRANSFER' }],
    ),
    expense(
      'utilities',
      'Gastos del local',
      'Servicios',
      'Servicios públicos del mes',
      40,
      420000,
      'PAID',
      [{ daysAgo: 40, amount: 420000, method: 'TRANSFER' }],
    ),
    expense(
      'supplier-purchase',
      'Mercancía',
      'Compra a proveedor',
      'Compra a proveedor para reposición',
      receivedOrder.sent?.daysAgo ?? 10,
      receivedOrder.total,
      'PAID',
      [
        {
          daysAgo: receivedOrder.sent?.daysAgo ?? 10,
          amount: receivedOrder.total,
          method: 'TRANSFER',
        },
      ],
      receivedOrder.supplierKey,
      receivedOrder.key,
    ),
  ];

  if (plan === 'BASIC') return shared;

  const supplierKey = suppliers[0]?.documentNumber ?? null;
  return [
    ...shared,
    expense(
      'supplies',
      'Gastos del local',
      'Insumos',
      'Insumos de aseo y cafetería',
      20,
      260000,
      'PARTIAL',
      [{ daysAgo: 20, amount: 100000, method: 'CASH' }],
    ),
    expense(
      'fuel',
      'Transporte',
      'Combustible',
      'Combustible para domicilios',
      15,
      180000,
      'PAID',
      [{ daysAgo: 15, amount: 180000, method: 'CASH' }],
    ),
    expense(
      'maintenance',
      'Herramientas y equipos',
      'Mantenimiento',
      'Mantenimiento del equipo de frío',
      25,
      320000,
      'PAID',
      [{ daysAgo: 25, amount: 320000, method: 'TRANSFER' }],
    ),
    expense(
      'freight',
      'Mercancía',
      'Fletes',
      'Flete de la última reposición',
      8,
      150000,
      'PAID',
      [{ daysAgo: 8, amount: 150000, method: 'CASH' }],
      supplierKey,
    ),
    expense(
      'petty-food',
      'Caja menor',
      'Alimentación',
      'Almuerzos del equipo',
      5,
      60000,
      'PAID',
      [{ daysAgo: 5, amount: 60000, method: 'CASH' }],
    ),
  ];
}

function buildEmployees(
  now: Date,
  staffEmailDomain: string,
): TestOrgEmployeePlan[] {
  const dayShifts = (
    startDaysAgo: number,
    shiftAmount: number,
    skipWeekday: number | null,
    description: string,
  ): TestOrgEmployeeShiftPlan[] => {
    const shifts: TestOrgEmployeeShiftPlan[] = [];
    for (let daysAgo = startDaysAgo; daysAgo >= 1; daysAgo -= 1) {
      const day = addDays(now, -daysAgo);
      const weekday = day.getUTCDay();
      if (weekday === 0) continue;
      if (skipWeekday !== null && weekday === skipWeekday) continue;
      shifts.push({
        date: isoDate(day),
        kind: 'FULL_DAY',
        amount: shiftAmount,
        observation: description,
      });
    }
    return shifts;
  };

  return [
    {
      key: 'maria',
      name: 'María Fernanda López',
      identification: '1010101010',
      phone: '3101112233',
      email: `maria.lopez@${staffEmailDomain}`,
      address: 'Calle 12 #34-56',
      jobTitle: 'Administradora',
      startDate: isoDate(addDays(now, -730)),
      remunerationModality: 'FIXED',
      referenceAmount: 2800000,
      active: true,
      shifts: [],
    },
    {
      key: 'juan',
      name: 'Juan Camilo Restrepo',
      identification: '1020202020',
      phone: '3102223344',
      email: `juan.restrepo@${staffEmailDomain}`,
      address: 'Cra 7 #21-09',
      jobTitle: 'Auxiliar de bodega',
      startDate: isoDate(addDays(now, -400)),
      remunerationModality: 'BY_DAY',
      referenceAmount: 70000,
      active: true,
      shifts: dayShifts(21, 70000, null, 'Turno de bodega'),
    },
    {
      key: 'sofia',
      name: 'Sofía Herrera',
      identification: '1030303030',
      phone: '3103334455',
      email: `sofia.herrera@${staffEmailDomain}`,
      address: 'Av 30 #14-22',
      jobTitle: 'Cajera',
      startDate: isoDate(addDays(now, -240)),
      remunerationModality: 'BY_DAY',
      referenceAmount: 65000,
      active: true,
      shifts: dayShifts(21, 65000, 1, 'Turno de caja'),
    },
    {
      key: 'andres',
      name: 'Andrés Felipe Mora',
      identification: '1040404040',
      phone: '3104445566',
      email: `andres.mora@${staffEmailDomain}`,
      address: 'Calle 45 #8-17',
      jobTitle: 'Domiciliario',
      startDate: isoDate(addDays(now, -180)),
      remunerationModality: 'BY_DAY',
      referenceAmount: 60000,
      active: true,
      shifts: dayShifts(14, 60000, null, 'Ruta de domicilios'),
    },
    {
      key: 'valentina',
      name: 'Valentina Ríos',
      identification: '1050505050',
      phone: '3105556677',
      email: `valentina.rios@${staffEmailDomain}`,
      address: 'Cra 19 #33-44',
      jobTitle: 'Auxiliar contable',
      startDate: isoDate(addDays(now, -365)),
      remunerationModality: 'FIXED',
      referenceAmount: 1900000,
      active: true,
      shifts: [],
    },
    {
      key: 'carlos',
      name: 'Carlos Mendoza',
      identification: '1060606060',
      phone: '3106667788',
      email: `carlos.mendoza@${staffEmailDomain}`,
      address: 'Calle 60 #5-11',
      jobTitle: 'Auxiliar de inventario',
      startDate: isoDate(addDays(now, -200)),
      remunerationModality: 'BY_DAY',
      referenceAmount: 62000,
      active: false,
      shifts: [],
    },
  ];
}

function buildPayroll(
  employees: TestOrgEmployeePlan[],
  now: Date,
): TestOrgPayrollPlan[] {
  const byKey = new Map(employees.map((employee) => [employee.key, employee]));
  const requireEmployee = (key: string): TestOrgEmployeePlan => {
    const employee = byKey.get(key);
    if (!employee) throw new Error(`Unknown employee ${key}`);
    return employee;
  };

  const group = (key: string, employeeKey: string): TestOrgPayrollPlan => {
    const employee = requireEmployee(employeeKey);
    if (employee.shifts.length === 0) {
      throw new Error(
        `Employee ${employeeKey} has no shifts for a payroll group`,
      );
    }
    const total = round2(
      employee.shifts.reduce((sum, shift) => sum + shift.amount, 0),
    );
    return {
      key,
      employeeKey,
      kind: 'SHIFT_GROUP',
      status: 'PENDING',
      version: 0,
      shiftDates: employee.shifts.map((shift) => shift.date),
      periodStart: null,
      periodEnd: null,
      periodAmount: null,
      payments: [],
      total,
    };
  };

  const previousMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const previousMonthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
  );
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const completedAmount = requireEmployee('maria').referenceAmount ?? 0;
  const pendingAmount = requireEmployee('valentina').referenceAmount ?? 0;

  return [
    group('group-juan', 'juan'),
    group('group-sofia', 'sofia'),
    group('group-andres', 'andres'),
    {
      key: 'fixed-maria',
      employeeKey: 'maria',
      kind: 'FIXED_PERIOD',
      status: 'COMPLETED',
      version: 1,
      shiftDates: [],
      periodStart: isoDate(previousMonthStart),
      periodEnd: isoDate(previousMonthEnd),
      periodAmount: completedAmount,
      payments: [
        {
          date: isoDate(previousMonthEnd),
          amount: completedAmount,
          method: 'TRANSFER',
        },
      ],
      total: completedAmount,
    },
    {
      key: 'fixed-valentina',
      employeeKey: 'valentina',
      kind: 'FIXED_PERIOD',
      status: 'PENDING',
      version: 0,
      shiftDates: [],
      periodStart: isoDate(currentMonthStart),
      periodEnd: isoDate(addDays(now, 5)),
      periodAmount: pendingAmount,
      payments: [],
      total: pendingAmount,
    },
  ];
}

interface LoanSeed {
  key: string;
  type: PlanLoanType;
  amount: number;
  issuedDaysAgo: number;
  dueDaysAgo: number | null;
  reason: string;
  counterparty: TestOrgMoneyLoanPlan['counterparty'];
  collections: { daysAgo: number; amount: number; method: PlanPaymentMethod }[];
  closedDaysAgo: number | null;
}

function buildMoneyLoans(
  customers: TestOrgCustomerPlan[],
  suppliers: TestOrgSupplierPlan[],
  now: Date,
): TestOrgMoneyLoanPlan[] {
  const customer = (
    documentNumber: string,
  ): TestOrgMoneyLoanPlan['counterparty'] => {
    if (!customers.some((row) => row.documentNumber === documentNumber)) {
      throw new Error(`Unknown customer ${documentNumber}`);
    }
    return { kind: 'customer', documentNumber };
  };
  const supplier = (
    documentNumber: string,
  ): TestOrgMoneyLoanPlan['counterparty'] => {
    if (!suppliers.some((row) => row.documentNumber === documentNumber)) {
      throw new Error(`Unknown supplier ${documentNumber}`);
    }
    return { kind: 'supplier', documentNumber };
  };

  const seeds: LoanSeed[] = [
    {
      key: 'customer-maria',
      type: 'MONEY',
      amount: 300000,
      issuedDaysAgo: 20,
      dueDaysAgo: -10,
      reason: 'Préstamo de demostración a cliente frecuente',
      counterparty: customer('1023456789'),
      collections: [{ daysAgo: 5, amount: 100000, method: 'CASH' }],
      closedDaysAgo: null,
    },
    {
      key: 'customer-carlos',
      type: 'MONEY',
      amount: 150000,
      issuedDaysAgo: 60,
      dueDaysAgo: 30,
      reason: 'Préstamo de demostración ya pagado',
      counterparty: customer('1045678901'),
      collections: [{ daysAgo: 45, amount: 150000, method: 'CASH' }],
      closedDaysAgo: 44,
    },
    {
      key: 'supplier-central',
      type: 'MONEY',
      amount: 800000,
      issuedDaysAgo: 15,
      dueDaysAgo: -15,
      reason: 'Préstamo de demostración a proveedor',
      counterparty: supplier('900123456-1'),
      collections: [],
      closedDaysAgo: null,
    },
    {
      key: 'user-admin',
      type: 'MONEY',
      amount: 200000,
      issuedDaysAgo: 30,
      dueDaysAgo: -30,
      reason: 'Préstamo de demostración a empleado',
      counterparty: { kind: 'user', userKey: 'admin' },
      collections: [{ daysAgo: 10, amount: 60000, method: 'TRANSFER' }],
      closedDaysAgo: null,
    },
    {
      key: 'service-ana',
      type: 'SERVICE',
      amount: 450000,
      issuedDaysAgo: 10,
      dueDaysAgo: -20,
      reason: 'Servicio de instalación y mantenimiento a crédito',
      counterparty: customer('1098765432'),
      collections: [],
      closedDaysAgo: null,
    },
  ];

  return seeds.map((seed) => {
    const issuedAt = isoDateTime(addDays(now, -seed.issuedDaysAgo));
    const dueAt =
      seed.dueDaysAgo === null
        ? null
        : isoDateTime(addDays(now, -seed.dueDaysAgo));
    const status: PlanLoanStatus =
      seed.closedDaysAgo === null ? 'OPEN' : 'CLOSED';

    let collectedCents = 0;
    const events: TestOrgMoneyLoanEventPlan[] = [
      {
        type: 'CREATED',
        createdAt: issuedAt,
        amount: null,
        method: null,
        reason: seed.reason,
        requestKey: null,
        requestPayload: null,
        result: null,
      },
    ];

    const totalCents = toCents(seed.amount);
    const orderedCollections = [...seed.collections].sort(
      (left, right) => right.daysAgo - left.daysAgo,
    );

    orderedCollections.forEach((collection, index) => {
      collectedCents += toCents(collection.amount);
      if (collectedCents > totalCents) {
        throw new Error(`Loan ${seed.key} collects more than its principal`);
      }
      const balanceCents = totalCents - collectedCents;
      const paymentStatus: TestOrgLoanResult['paymentStatus'] =
        balanceCents === 0
          ? 'PAID'
          : collectedCents === 0
            ? 'UNPAID'
            : 'PARTIAL';
      events.push({
        type: 'COLLECTED',
        createdAt: isoDateTime(addDays(now, -collection.daysAgo)),
        amount: collection.amount,
        method: collection.method,
        reason: 'Abono recibido',
        requestKey: `prueba-${seed.key}-collect-${index + 1}`,
        requestPayload: {
          kind: 'COLLECTED',
          amount: fromCents(toCents(collection.amount)).toFixed(2),
          method: collection.method,
          reason: 'Abono recibido',
          paymentId: null,
        },
        result: {
          type: seed.type,
          status: 'OPEN',
          collected: moneyText(collectedCents),
          balance: moneyText(balanceCents),
          paymentStatus,
        },
      });
    });

    const finalBalanceCents = totalCents - collectedCents;
    if (seed.closedDaysAgo !== null) {
      if (finalBalanceCents !== 0) {
        throw new Error(`Closed loan ${seed.key} still has a balance`);
      }
      events.push({
        type: 'CLOSED',
        createdAt: isoDateTime(addDays(now, -seed.closedDaysAgo)),
        amount: null,
        method: null,
        reason: 'Cierre confirmado',
        requestKey: `prueba-${seed.key}-close`,
        requestPayload: {
          kind: 'CLOSED',
          amount: null,
          method: null,
          reason: 'Cierre confirmado',
          paymentId: null,
        },
        result: {
          type: seed.type,
          status: 'CLOSED',
          collected: moneyText(collectedCents),
          balance: '0.00',
          paymentStatus: 'PAID',
        },
      });
    }

    return {
      key: seed.key,
      type: seed.type,
      amount: seed.amount,
      issuedAt,
      dueAt,
      reason: seed.reason,
      counterparty: seed.counterparty,
      status,
      version: seed.collections.length + (seed.closedDaysAgo === null ? 0 : 1),
      events,
    };
  });
}

function buildInventoryLoans(): TestOrgInventoryLoanPlan[] {
  return [
    {
      key: 'loan-papeleria',
      status: 'OPEN',
      customerDocumentNumber: '1045678901',
      createdDaysAgo: 4,
      items: [{ sku: 'PAP-001', quantity: 3 }],
      events: [{ type: 'CREATED', daysAgo: 4 }],
    },
  ];
}

function buildStockTransfers(): {
  transfers: TestOrgStockTransferPlan[];
  siteStock: TestOrgSiteStockPlan[];
} {
  const transfers: TestOrgStockTransferPlan[] = [
    {
      key: 'transfer-norte',
      number: 1,
      fromLocationName: 'Sede principal',
      toLocationName: 'Sucursal Norte',
      status: 'RECEIVED',
      notes: 'Traslado de apertura a la sucursal',
      createdDaysAgo: 20,
      receivedDaysAgo: 18,
      items: [
        { sku: 'BEB-001', quantity: 40 },
        { sku: 'ASE-002', quantity: 30 },
      ],
    },
  ];

  // The seed models a transfer that already landed, so the destination site
  // holds exactly what the transfer delivered.
  const siteStock: TestOrgSiteStockPlan[] = transfers.flatMap((transfer) =>
    transfer.items.map((item) => ({
      sku: item.sku,
      locationName: transfer.toLocationName,
      quantity: item.quantity,
    })),
  );

  return { transfers, siteStock };
}

function buildTasks(plan: 'PRO' | 'BASIC'): TestOrgTaskPlan[] {
  if (plan === 'BASIC') {
    return [
      {
        key: 'count-drinks',
        title: 'Revisar stock de bebidas',
        description: 'Confirmar el conteo físico antes del pedido semanal.',
        status: 'PENDING',
        assignedTo: 'admin',
        dueInDays: 2,
        events: [
          {
            type: 'CREATED',
            fromStatus: null,
            toStatus: 'PENDING',
            note: null,
            daysAgo: 1,
          },
        ],
      },
      {
        key: 'cash-reconciliation',
        title: 'Cuadre de caja de la semana',
        description:
          'Comparar el efectivo contado contra el cierre del sistema.',
        status: 'IN_PROGRESS',
        assignedTo: 'admin',
        dueInDays: 1,
        events: [
          {
            type: 'CREATED',
            fromStatus: null,
            toStatus: 'PENDING',
            note: null,
            daysAgo: 3,
          },
          {
            type: 'STATUS_CHANGED',
            fromStatus: 'PENDING',
            toStatus: 'IN_PROGRESS',
            note: 'Falta el cierre del sábado.',
            daysAgo: 1,
          },
        ],
      },
    ];
  }

  return [
    {
      key: 'stock-drinks',
      title: 'Revisar stock de bebidas',
      description: 'Confirmar el conteo físico antes del pedido semanal.',
      status: 'PENDING',
      assignedTo: 'admin',
      dueInDays: 2,
      events: [
        {
          type: 'CREATED',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          daysAgo: 1,
        },
      ],
    },
    {
      key: 'call-dairy',
      title: 'Llamar al proveedor de lácteos',
      description: 'Confirmar precios y fecha de entrega.',
      status: 'IN_PROGRESS',
      assignedTo: 'admin',
      dueInDays: 1,
      events: [
        {
          type: 'CREATED',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          daysAgo: 2,
        },
        {
          type: 'STATUS_CHANGED',
          fromStatus: 'PENDING',
          toStatus: 'IN_PROGRESS',
          note: 'Se dejó mensaje al proveedor.',
          daysAgo: 1,
        },
      ],
    },
    {
      key: 'cash-reconciliation',
      title: 'Cuadre de caja de la semana',
      description: 'Comparar el efectivo contado contra el cierre del sistema.',
      status: 'COMPLETED',
      assignedTo: 'admin',
      dueInDays: -1,
      events: [
        {
          type: 'CREATED',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          daysAgo: 6,
        },
        {
          type: 'STATUS_CHANGED',
          fromStatus: 'PENDING',
          toStatus: 'COMPLETED',
          note: 'Sin diferencias.',
          daysAgo: 2,
        },
      ],
    },
    {
      key: 'electronics-prices',
      title: 'Actualizar precios de electrónica',
      description: 'Revisar márgenes de la línea de accesorios.',
      status: 'PENDING',
      assignedTo: 'admin',
      dueInDays: 5,
      events: [
        {
          type: 'CREATED',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          daysAgo: 3,
        },
      ],
    },
    {
      key: 'cold-room',
      title: 'Programar mantenimiento del cuarto frío',
      description: 'El proveedor no confirmó la visita de este mes.',
      status: 'CANCELLED',
      assignedTo: 'admin',
      dueInDays: null,
      events: [
        {
          type: 'CREATED',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          daysAgo: 9,
        },
        {
          type: 'STATUS_CHANGED',
          fromStatus: 'PENDING',
          toStatus: 'CANCELLED',
          note: 'Se reprograma para el próximo mes.',
          daysAgo: 4,
        },
      ],
    },
  ];
}

// ─── Plan assembly ─────────────────────────────────────────────────────────

function buildProPlan(now: Date, asOf: Date): TestOrgPlan {
  const identity = TEST_ORGS.pro;
  const users = buildUsers(identity);
  const products = buildProducts('PRO');
  const customers = [...CUSTOMER_CATALOG];
  const suppliers = [...SUPPLIER_CATALOG];
  const purchaseOrders = buildPurchaseOrders(products, suppliers, 'PRO', now);
  const sales = buildSales(products, customers, now, asOf, {
    seed: 20261106,
    days: 75,
  });
  const expenses = buildExpenses(suppliers, purchaseOrders, 'PRO');
  const employees = buildEmployees(now, identity.staffDomain);
  const payroll = buildPayroll(employees, now);
  const moneyLoans = buildMoneyLoans(customers, suppliers, now);
  const { transfers, siteStock } = buildStockTransfers();

  return {
    organization: {
      name: identity.name,
      slug: identity.slug,
      plan: 'PRO',
      taxId: identity.taxId,
      phone: identity.phone,
      address: identity.address,
      status: 'ACTIVE',
      billingStatus: 'PAID',
      settings: {
        printHeader: identity.name,
        printFooter: 'Gracias por su compra',
        purchaseOrderTemplate: {
          deliveryAddress: 'Bodega principal, Calle 100 #15-20, Bogotá',
          paymentTerms: 'Pago a 30 días',
          terms: 'Los precios incluyen IVA cuando aplica.',
          footer: 'Documento generado por MeperPOS',
        },
      },
      sequences: [
        { type: 'SALE', prefix: 'REC' },
        { type: 'PO', prefix: 'OC' },
        { type: 'TRANSFER', prefix: null },
      ],
      locations: [
        {
          name: 'Sede principal',
          type: 'STORE',
          isDefault: true,
          address: 'Calle 100 #15-20, Bogotá',
          phone: '6015550101',
        },
        {
          name: 'Sucursal Norte',
          type: 'WAREHOUSE',
          isDefault: false,
          address: 'Cra 15 #120-40, Bogotá',
          phone: '6015550102',
        },
      ],
      cashRegisters: ['Caja Principal', 'Caja Secundaria'],
    },
    users,
    categories: buildCategories(products),
    products,
    customers,
    suppliers,
    purchaseOrders,
    sales,
    expenses,
    employees,
    payroll,
    moneyLoans,
    inventoryLoans: buildInventoryLoans(),
    stockTransfers: transfers,
    siteStock,
    tasks: buildTasks('PRO'),
  };
}

function buildBasicPlan(now: Date, asOf: Date): TestOrgPlan {
  const identity = TEST_ORGS.basic;
  const users = buildUsers(identity);
  const products = buildProducts('BASIC');
  const customers = CUSTOMER_CATALOG.slice(0, 5).map((customer) => ({
    ...customer,
  }));
  const suppliers = SUPPLIER_CATALOG.slice(0, 2).map((supplier) => ({
    ...supplier,
  }));
  const purchaseOrders = buildPurchaseOrders(products, suppliers, 'BASIC', now);
  const sales = buildSales(products, customers, now, asOf, {
    seed: 20261107,
    days: 21,
  });

  return {
    organization: {
      name: identity.name,
      slug: identity.slug,
      plan: 'BASIC',
      taxId: identity.taxId,
      phone: identity.phone,
      address: identity.address,
      status: 'ACTIVE',
      billingStatus: 'PAID',
      settings: {
        printHeader: identity.name,
        printFooter: 'Gracias por su compra',
        purchaseOrderTemplate: {
          deliveryAddress: 'Cra 43A #1-50, Medellín',
          paymentTerms: 'Pago de contado',
          terms: 'Los precios incluyen IVA cuando aplica.',
          footer: 'Documento generado por MeperPOS',
        },
      },
      sequences: [
        { type: 'SALE', prefix: 'REC' },
        { type: 'PO', prefix: 'OC' },
      ],
      locations: [
        {
          name: 'Sede principal',
          type: 'STORE',
          isDefault: true,
          address: 'Cra 43A #1-50, Medellín',
          phone: '6044440102',
        },
      ],
      cashRegisters: ['Caja Principal'],
    },
    users,
    categories: buildCategories(products),
    products,
    customers,
    suppliers,
    purchaseOrders,
    sales,
    expenses: buildExpenses(suppliers, purchaseOrders, 'BASIC'),
    employees: [],
    payroll: [],
    moneyLoans: [],
    inventoryLoans: [],
    stockTransfers: [],
    siteStock: [],
    tasks: buildTasks('BASIC'),
  };
}

// ─── Invariant assertions ──────────────────────────────────────────────────

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function assertPurchaseOrders(plan: TestOrgPlan): void {
  for (const order of plan.purchaseOrders) {
    if (order.items.length === 0) {
      throw new Error(`Purchase order ${order.key} has no items`);
    }
    for (const item of order.items) {
      if (item.qtyReceived < 0 || item.qtyReceived > item.qtyOrdered) {
        throw new Error(
          `Purchase order ${order.key} has invalid received quantity`,
        );
      }
    }
    const received = order.items.reduce(
      (sum, item) => sum + item.qtyReceived,
      0,
    );
    const ordered = order.items.reduce((sum, item) => sum + item.qtyOrdered, 0);
    if (order.status === 'DRAFT' || order.status === 'PENDING') {
      if (received !== 0) {
        throw new Error(`Order ${order.key} should not be received`);
      }
    }
    if (
      order.status === 'PARTIAL_RECEIVED' &&
      (received === 0 || received === ordered)
    ) {
      throw new Error(`Order ${order.key} is not partially received`);
    }
    if (order.status === 'RECEIVED' && received !== ordered) {
      throw new Error(`Order ${order.key} is not fully received`);
    }
    if (order.status === 'DRAFT' && order.sent !== null) {
      throw new Error(`Draft order ${order.key} cannot have been sent`);
    }
    if (order.sent !== null && order.confirmedAt === null) {
      throw new Error(`Order ${order.key} was sent without being confirmed`);
    }
    const subtotal = round2(
      order.items.reduce((sum, item) => sum + item.subtotal, 0),
    );
    const taxAmount = round2(
      order.items.reduce((sum, item) => sum + item.taxAmount, 0),
    );
    if (subtotal !== order.subtotal || taxAmount !== order.taxAmount) {
      throw new Error(`Order ${order.key} has inconsistent totals`);
    }
    if (round2(order.subtotal + order.taxAmount) !== order.total) {
      throw new Error(`Order ${order.key} total does not add up`);
    }
  }
}

function assertSales(plan: TestOrgPlan): void {
  for (const sale of plan.sales) {
    if (sale.items.length === 0) throw new Error('Sale without items');
    assertUnique(
      sale.items.map((item) => item.sku),
      `sale ${sale.saleNumber} item SKU`,
    );
    for (const item of sale.items) {
      if (item.quantity <= 0) {
        throw new Error(`Sale ${sale.saleNumber} has a non-positive quantity`);
      }
      const expectedSubtotal = round2(item.unitPrice * item.quantity);
      const expectedTax = round2(expectedSubtotal * (item.taxRate / 100));
      if (item.subtotal !== expectedSubtotal) {
        throw new Error(
          `Sale ${sale.saleNumber} line subtotal is inconsistent`,
        );
      }
      if (item.total !== round2(expectedSubtotal + expectedTax)) {
        throw new Error(`Sale ${sale.saleNumber} line total is inconsistent`);
      }
    }
    const subtotal = round2(
      sale.items.reduce((sum, item) => sum + item.subtotal, 0),
    );
    const taxAmount = round2(
      sale.items.reduce((sum, item) => sum + item.total - item.subtotal, 0),
    );
    if (subtotal !== sale.subtotal || taxAmount !== sale.taxAmount) {
      throw new Error(`Sale ${sale.saleNumber} has inconsistent totals`);
    }
    if (round2(sale.subtotal + sale.taxAmount) !== sale.total) {
      throw new Error(`Sale ${sale.saleNumber} total does not add up`);
    }
    const paid = round2(
      sale.payments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    if (paid !== sale.amountPaid) {
      throw new Error(
        `Sale ${sale.saleNumber} payments do not match amount paid`,
      );
    }
    if (sale.amountPaid < sale.total) {
      throw new Error(`Sale ${sale.saleNumber} is underpaid`);
    }
    if (round2(sale.amountPaid - sale.total) !== sale.change) {
      throw new Error(`Sale ${sale.saleNumber} change is inconsistent`);
    }
  }
}

function assertExpenses(plan: TestOrgPlan): void {
  for (const expense of plan.expenses) {
    if (expense.payments.length === 0) {
      throw new Error(`Expense ${expense.key} has no payments`);
    }
    const paid = round2(
      expense.payments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    if (paid > expense.total) {
      throw new Error(`Expense ${expense.key} is overpaid`);
    }
    if (expense.status === 'PAID' && paid !== expense.total) {
      throw new Error(`Expense ${expense.key} is marked paid but is not`);
    }
    if (
      expense.status === 'PARTIAL' &&
      (paid === 0 || paid === expense.total)
    ) {
      throw new Error(`Expense ${expense.key} is not partially paid`);
    }
  }
}

function assertPayroll(plan: TestOrgPlan): void {
  const employeeByKey = new Map(
    plan.employees.map((employee) => [employee.key, employee]),
  );
  const usedShifts = new Set<string>();
  for (const employee of plan.employees) {
    assertUnique(
      employee.shifts.map((shift) => shift.date),
      `shift date for ${employee.key}`,
    );
    if (!employee.active && employee.shifts.length > 0) {
      throw new Error(`Inactive employee ${employee.key} cannot have shifts`);
    }
  }
  for (const payroll of plan.payroll) {
    const employee = employeeByKey.get(payroll.employeeKey);
    if (!employee) {
      throw new Error(`Unknown payroll employee ${payroll.employeeKey}`);
    }
    if (payroll.kind === 'SHIFT_GROUP') {
      if (payroll.shiftDates.length === 0) {
        throw new Error(`Payroll group ${payroll.key} has no shifts`);
      }
      for (const date of payroll.shiftDates) {
        const shift = employee.shifts.find((row) => row.date === date);
        if (!shift) {
          throw new Error(
            `Payroll ${payroll.key} references an unknown shift ${date}`,
          );
        }
        const identity = `${payroll.employeeKey}:${date}`;
        if (usedShifts.has(identity)) {
          throw new Error(`Shift ${identity} belongs to two payroll groups`);
        }
        usedShifts.add(identity);
      }
      const total = round2(
        payroll.shiftDates.reduce((sum, date) => {
          const shift = employee.shifts.find((row) => row.date === date);
          return sum + (shift?.amount ?? 0);
        }, 0),
      );
      if (total !== payroll.total) {
        throw new Error(`Payroll group ${payroll.key} total is inconsistent`);
      }
    } else if (
      !payroll.periodStart ||
      !payroll.periodEnd ||
      payroll.periodAmount === null
    ) {
      throw new Error(`Fixed payroll ${payroll.key} is missing its period`);
    }
    const paid = round2(
      payroll.payments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    if (paid > payroll.total) {
      throw new Error(`Payroll ${payroll.key} is overpaid`);
    }
    if (payroll.status === 'COMPLETED' && paid !== payroll.total) {
      throw new Error(`Payroll ${payroll.key} is marked completed but is not`);
    }
    if (payroll.status === 'PENDING' && paid === payroll.total) {
      throw new Error(`Payroll ${payroll.key} is pending but fully paid`);
    }
  }
}

function assertMoneyLoans(plan: TestOrgPlan): void {
  for (const loan of plan.moneyLoans) {
    if (loan.events[0]?.type !== 'CREATED') {
      throw new Error(`Loan ${loan.key} must start with a CREATED event`);
    }
    let collectedCents = 0;
    let closed = false;
    for (const event of loan.events) {
      if (event.type === 'COLLECTED') {
        if (event.amount === null || event.amount <= 0) {
          throw new Error(`Loan ${loan.key} has an invalid collection`);
        }
        if (!event.requestKey || !event.requestPayload || !event.result) {
          throw new Error(`Loan ${loan.key} collection is missing evidence`);
        }
        collectedCents += toCents(event.amount);
      }
      if (event.type === 'CLOSED') {
        closed = true;
        if (!event.requestKey || !event.requestPayload || !event.result) {
          throw new Error(`Loan ${loan.key} close is missing evidence`);
        }
      }
      if (event.type === 'CREATED') {
        if (
          event.amount !== null ||
          event.requestKey !== null ||
          event.result !== null
        ) {
          throw new Error(`Loan ${loan.key} CREATED event has extra evidence`);
        }
      }
    }
    const totalCents = toCents(loan.amount);
    if (collectedCents > totalCents) {
      throw new Error(`Loan ${loan.key} collects more than its principal`);
    }
    const balanceCents = totalCents - collectedCents;
    if (loan.status === 'CLOSED' && (!closed || balanceCents !== 0)) {
      throw new Error(`Closed loan ${loan.key} is inconsistent`);
    }
    if (loan.status === 'OPEN' && closed) {
      throw new Error(`Open loan ${loan.key} has a CLOSED event`);
    }
  }
}

function assertSites(plan: TestOrgPlan): void {
  const locationNames = plan.organization.locations.map(
    (location) => location.name,
  );
  assertUnique(locationNames, 'location name');
  const defaults = plan.organization.locations.filter(
    (location) => location.isDefault,
  );
  if (defaults.length !== 1) {
    throw new Error(
      `Organization ${plan.organization.slug} must have exactly one default location`,
    );
  }
  if (defaults[0].type !== 'STORE') {
    throw new Error(
      `Organization ${plan.organization.slug} default location must be a store`,
    );
  }

  const productBySku = new Map(
    plan.products.map((product) => [product.sku, product]),
  );

  for (const transfer of plan.stockTransfers) {
    if (!locationNames.includes(transfer.fromLocationName)) {
      throw new Error(
        `Stock transfer ${transfer.key} names an unknown location ${transfer.fromLocationName}`,
      );
    }
    if (!locationNames.includes(transfer.toLocationName)) {
      throw new Error(
        `Stock transfer ${transfer.key} names an unknown location ${transfer.toLocationName}`,
      );
    }
    if (transfer.fromLocationName === transfer.toLocationName) {
      throw new Error(`Stock transfer ${transfer.key} moves stock to itself`);
    }
    if (transfer.status === 'RECEIVED' && transfer.receivedDaysAgo === null) {
      throw new Error(`Stock transfer ${transfer.key} has no receipt date`);
    }
    for (const item of transfer.items) {
      const product = productBySku.get(item.sku);
      if (!product) {
        throw new Error(
          `Stock transfer ${transfer.key} names an unknown product ${item.sku}`,
        );
      }
      if (!product.tracksStock) {
        throw new Error(
          `Stock transfer ${transfer.key} moves untracked product ${item.sku}`,
        );
      }
      if (item.quantity <= 0 || item.quantity > product.stock) {
        throw new Error(
          `Stock transfer ${transfer.key} has an invalid quantity for ${item.sku}`,
        );
      }
    }
  }

  for (const entry of plan.siteStock) {
    if (!locationNames.includes(entry.locationName)) {
      throw new Error(
        `Site stock names an unknown location ${entry.locationName}`,
      );
    }
    const product = productBySku.get(entry.sku);
    if (!product) {
      throw new Error(`Site stock names an unknown product ${entry.sku}`);
    }
    if (entry.quantity <= 0 || entry.quantity > product.stock) {
      throw new Error(
        `Site stock for ${entry.sku} exceeds the product stock (${entry.quantity} > ${product.stock})`,
      );
    }
  }
}

function assertInventoryLoans(plan: TestOrgPlan): void {
  const skus = new Set(plan.products.map((product) => product.sku));
  for (const loan of plan.inventoryLoans) {
    if (loan.items.length === 0) {
      throw new Error(`Inventory loan ${loan.key} has no items`);
    }
    if (loan.events.length === 0 || loan.events[0].type !== 'CREATED') {
      throw new Error(
        `Inventory loan ${loan.key} must start with a CREATED event`,
      );
    }
    for (const item of loan.items) {
      if (!skus.has(item.sku)) {
        throw new Error(
          `Inventory loan ${loan.key} names an unknown product ${item.sku}`,
        );
      }
      if (item.quantity <= 0) {
        throw new Error(
          `Inventory loan ${loan.key} has a non-positive quantity`,
        );
      }
    }
  }
}

function assertTasks(plan: TestOrgPlan): void {
  for (const task of plan.tasks) {
    if (task.events.length === 0) {
      throw new Error(`Task ${task.key} has no events`);
    }
    const last = task.events[task.events.length - 1];
    if (last.toStatus !== task.status) {
      throw new Error(`Task ${task.key} status does not match its last event`);
    }
  }
}

function assertPlanLimits(plan: TestOrgPlan): void {
  const limits = PLAN_LIMITS[plan.organization.plan];
  if (limits.maxUsers > 0 && plan.users.length > limits.maxUsers) {
    throw new Error(
      `${plan.organization.slug} exceeds the ${plan.organization.plan} plan limit for users`,
    );
  }
  if (limits.maxProducts > 0 && plan.products.length > limits.maxProducts) {
    throw new Error(
      `${plan.organization.slug} exceeds the ${plan.organization.plan} plan limit for products`,
    );
  }
  if (limits.maxCustomers > 0 && plan.customers.length > limits.maxCustomers) {
    throw new Error(
      `${plan.organization.slug} exceeds the ${plan.organization.plan} plan limit for customers`,
    );
  }
  if (
    limits.maxCashRegisters > 0 &&
    plan.organization.cashRegisters.length !== limits.maxCashRegisters
  ) {
    throw new Error(
      `${plan.organization.slug} exceeds the ${plan.organization.plan} plan limit for cash registers`,
    );
  }
}

function assertOrganization(plan: TestOrgPlan): void {
  const slug = plan.organization.slug;
  assertUnique(
    plan.users.map((user) => user.email),
    'user email',
  );
  assertUnique(
    plan.categories.map((category) => category.name),
    'category name',
  );
  assertUnique(
    plan.products.map((product) => product.sku),
    'product SKU',
  );
  assertUnique(
    plan.products.map((product) => product.barcode),
    'product barcode',
  );
  assertUnique(
    plan.customers.map((customer) => customer.documentNumber),
    'customer document',
  );
  assertUnique(
    plan.suppliers.map((supplier) => supplier.documentNumber),
    'supplier document',
  );
  assertUnique(
    plan.employees.map((employee) => employee.identification),
    'employee identification',
  );
  assertUnique(
    plan.moneyLoans.map((loan) => loan.key),
    'loan key',
  );
  assertUnique(
    plan.inventoryLoans.map((loan) => loan.key),
    'inventory loan key',
  );
  assertUnique(
    plan.stockTransfers.map((transfer) => transfer.key),
    'stock transfer key',
  );
  assertUnique(
    plan.tasks.map((task) => task.title),
    'task title',
  );
  assertUnique(
    plan.sales.map((sale) => String(sale.saleNumber)),
    'sale number',
  );
  assertUnique(
    plan.purchaseOrders.map((order) => order.notes),
    'purchase order notes',
  );
  assertUnique(plan.organization.cashRegisters, 'cash register name');

  const owners = plan.users.filter((user) => user.isPrimaryOwner);
  if (owners.length !== 1 || owners[0].role !== 'ADMIN') {
    throw new Error(
      `Organization ${slug} must have exactly one ADMIN primary owner`,
    );
  }
  if (plan.users.length !== 1) {
    throw new Error(
      `Organization ${slug} must have exactly one membership (found ${plan.users.length})`,
    );
  }

  for (const product of plan.products) {
    if (product.costPrice < 0 || product.salePrice <= 0) {
      throw new Error(`Product ${product.sku} has invalid prices`);
    }
    if (product.type === 'PRODUCT' && product.salePrice < product.costPrice) {
      throw new Error(`Product ${product.sku} sells below cost`);
    }
    if (product.stock < 0 || product.openingStock < 0) {
      throw new Error(`Product ${product.sku} has negative stock`);
    }
    if (
      product.type === 'SERVICE' &&
      (product.tracksStock || product.stock !== 0)
    ) {
      throw new Error(`Service ${product.sku} must not track stock`);
    }
  }

  assertPurchaseOrders(plan);
  assertSales(plan);
  assertExpenses(plan);
  assertPayroll(plan);
  assertMoneyLoans(plan);
  assertSites(plan);
  assertInventoryLoans(plan);
  assertTasks(plan);
  assertPlanLimits(plan);
}

/**
 * Proofs the runner relies on. Kept exported so the focused test can run the
 * exact same checks over a fully built plan, including a fixed `now`.
 */
export function assertTestOrgsPlan(plan: TestOrgsSeedPlan): void {
  if (plan.organizations.length !== 2) {
    throw new Error(
      `The test-orgs seed creates exactly two organizations (got ${plan.organizations.length})`,
    );
  }
  assertUnique(
    plan.organizations.map((row) => row.organization.slug),
    'organization slug',
  );
  assertUnique(
    plan.organizations.map((row) => row.organization.name),
    'organization name',
  );

  for (const row of plan.organizations) {
    assertOrganization(row);
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export function buildTestOrgsSeedPlan(
  input: TestOrgsSeedInput = {},
): TestOrgsSeedPlan {
  const asOf = input.now ?? new Date();
  const now = startOfUtcDay(asOf);

  const plan: TestOrgsSeedPlan = {
    organizations: [buildProPlan(now, asOf), buildBasicPlan(now, asOf)],
  };

  assertTestOrgsPlan(plan);
  return plan;
}

/** Human-readable count summary used by the CLI before and after applying. */
export function summarizeTestOrgsPlan(plan: TestOrgsSeedPlan): string[] {
  return plan.organizations.flatMap((row) => [
    `organization: ${row.organization.name} (${row.organization.slug}) — plan ${row.organization.plan}`,
    `  users: ${row.users.length}`,
    `  locations: ${row.organization.locations.length}`,
    `  cash registers: ${row.organization.cashRegisters.length}`,
    `  categories: ${row.categories.length}`,
    `  products: ${row.products.length}`,
    `  customers: ${row.customers.length}`,
    `  suppliers: ${row.suppliers.length}`,
    `  purchase orders: ${row.purchaseOrders.length} (sent: ${row.purchaseOrders.filter((order) => order.sent !== null).length})`,
    `  sales: ${row.sales.length}`,
    `  expenses: ${row.expenses.length}`,
    `  employees: ${row.employees.length}`,
    `  employee shifts: ${row.employees.reduce((sum, employee) => sum + employee.shifts.length, 0)}`,
    `  payroll obligations: ${row.payroll.length}`,
    `  money loans: ${row.moneyLoans.length}`,
    `  money loan events: ${row.moneyLoans.reduce((sum, loan) => sum + loan.events.length, 0)}`,
    `  inventory loans: ${row.inventoryLoans.length}`,
    `  stock transfers: ${row.stockTransfers.length}`,
    `  tasks: ${row.tasks.length}`,
  ]);
}
