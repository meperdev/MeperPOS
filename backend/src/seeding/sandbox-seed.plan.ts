/**
 * Pure data plan for the production sandbox seed.
 *
 * This module decides WHAT the sandbox organization contains and proves its
 * internal arithmetic (totals, payment sums, payroll balances, loan balances,
 * unique keys). `prisma/seed-sandbox.ts` decides WHEN and HOW those rows are
 * written. Keeping the plan pure means every invariant can be tested without a
 * database, which is the only regression net a seed script can have.
 *
 * The plan is deterministic for a given `now`: the same input always produces
 * the same rows, so a dry run describes exactly what an `--apply` would write.
 */

export type PlanRole = 'OWNER' | 'ADMIN' | 'CASHIER' | 'INVENTORY_USER';

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

export type SandboxUserKey =
  | 'owner'
  | 'admin'
  | 'cashier'
  | 'inventory'
  | 'secondCashier';

export interface SandboxSeedInput {
  organizationName: string;
  organizationSlug: string;
  ownerName: string;
  ownerEmail: string;
  staffEmailDomain: string;
  now?: Date;
}

export interface SandboxUserPlan {
  key: SandboxUserKey;
  email: string;
  name: string;
  role: PlanRole;
  isPrimaryOwner: boolean;
}

export interface SandboxCategoryPlan {
  name: string;
  description: string;
  taxable: boolean;
  defaultTaxRate: number;
}

export interface SandboxProductPlan {
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

export interface SandboxCustomerPlan {
  documentNumber: string;
  documentType: 'CC' | 'NIT';
  name: string;
  email: string;
  phone: string;
  address: string;
  segment: PlanCustomerSegment;
}

export interface SandboxSupplierPlan {
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

export interface SandboxPurchaseOrderItemPlan {
  sku: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
}

export interface SandboxPurchaseOrderPlan {
  key: string;
  notes: string;
  supplierKey: string;
  status: PlanPurchaseOrderStatus;
  createdAt: string;
  confirmedAt: string | null;
  receivedAt: string | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  items: SandboxPurchaseOrderItemPlan[];
}

export interface SandboxSaleItemPlan {
  sku: string;
  quantity: number;
  unitPrice: number;
  costPriceSnapshot: number;
  taxRate: number;
  subtotal: number;
  total: number;
}

export interface SandboxSalePaymentPlan {
  method: PlanPaymentMethod;
  amount: number;
}

export interface SandboxSalePlan {
  saleNumber: number;
  createdAt: string;
  customerDocumentNumber: string | null;
  userKey: SandboxUserKey;
  status: PlanSaleStatus;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  amountPaid: number;
  change: number;
  items: SandboxSaleItemPlan[];
  payments: SandboxSalePaymentPlan[];
}

export interface SandboxExpensePaymentPlan {
  daysAgo: number;
  amount: number;
  method: PlanPaymentMethod;
}

export interface SandboxExpensePlan {
  key: string;
  groupName: string;
  labelName: string;
  supplierKey: string | null;
  purchaseOrderKey: string | null;
  description: string;
  daysAgo: number;
  total: number;
  status: 'PAID' | 'PARTIAL';
  payments: SandboxExpensePaymentPlan[];
}

export interface SandboxEmployeeShiftPlan {
  date: string;
  kind: PlanShiftKind;
  amount: number;
  observation: string | null;
}

export interface SandboxEmployeePlan {
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
  shifts: SandboxEmployeeShiftPlan[];
}

export interface SandboxPayrollPaymentPlan {
  date: string;
  amount: number;
  method: PlanPaymentMethod;
}

export interface SandboxPayrollPlan {
  key: string;
  employeeKey: string;
  kind: PlanPayrollKind;
  status: PlanPayrollStatus;
  version: number;
  shiftDates: string[];
  periodStart: string | null;
  periodEnd: string | null;
  periodAmount: number | null;
  payments: SandboxPayrollPaymentPlan[];
  total: number;
}

export interface SandboxLoanResult {
  type: PlanLoanType;
  status: PlanLoanStatus;
  collected: string;
  balance: string;
  paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
}

export interface SandboxMoneyLoanEventPlan {
  type: PlanLoanEventType;
  createdAt: string;
  amount: number | null;
  method: PlanPaymentMethod | null;
  reason: string;
  requestKey: string | null;
  requestPayload: Record<string, unknown> | null;
  result: SandboxLoanResult | null;
}

export interface SandboxMoneyLoanPlan {
  key: string;
  type: PlanLoanType;
  amount: number;
  issuedAt: string;
  dueAt: string | null;
  reason: string;
  counterparty:
    | { kind: 'customer'; documentNumber: string }
    | { kind: 'supplier'; documentNumber: string }
    | { kind: 'user'; userKey: SandboxUserKey };
  status: PlanLoanStatus;
  version: number;
  events: SandboxMoneyLoanEventPlan[];
}

export interface SandboxTaskEventPlan {
  type: 'CREATED' | 'STATUS_CHANGED';
  fromStatus: PlanTaskStatus | null;
  toStatus: PlanTaskStatus;
  note: string | null;
  daysAgo: number;
}

export interface SandboxTaskPlan {
  key: string;
  title: string;
  description: string;
  status: PlanTaskStatus;
  assignedTo: SandboxUserKey;
  dueInDays: number | null;
  events: SandboxTaskEventPlan[];
}

export interface SandboxOrganizationPlan {
  name: string;
  slug: string;
  taxId: string;
  phone: string;
  address: string;
  plan: 'PRO';
  status: 'ACTIVE';
  billingStatus: 'PAID';
  settings: { printHeader: string; printFooter: string };
  sequences: { type: 'SALE' | 'PO'; prefix: string }[];
  cashRegisters: string[];
}

export interface SandboxSeedPlan {
  organization: SandboxOrganizationPlan;
  users: SandboxUserPlan[];
  categories: SandboxCategoryPlan[];
  products: SandboxProductPlan[];
  customers: SandboxCustomerPlan[];
  suppliers: SandboxSupplierPlan[];
  purchaseOrders: SandboxPurchaseOrderPlan[];
  sales: SandboxSalePlan[];
  expenses: SandboxExpensePlan[];
  employees: SandboxEmployeePlan[];
  payroll: SandboxPayrollPlan[];
  moneyLoans: SandboxMoneyLoanPlan[];
  tasks: SandboxTaskPlan[];
}

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
    throw new Error('Invalid monetary amount in the sandbox plan');
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

// ─── Static catalog ────────────────────────────────────────────────────────

const CATEGORIES: SandboxCategoryPlan[] = [
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

const PRODUCTS: ProductDefinition[] = [
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

const CUSTOMERS: SandboxCustomerPlan[] = [
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

const SUPPLIERS: SandboxSupplierPlan[] = [
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

function buildUsers(input: SandboxSeedInput): SandboxUserPlan[] {
  const domain = input.staffEmailDomain;
  return [
    {
      key: 'owner',
      email: input.ownerEmail,
      name: input.ownerName,
      role: 'OWNER',
      isPrimaryOwner: true,
    },
    {
      key: 'admin',
      email: `admin@${domain}`,
      name: 'Camila Restrepo',
      role: 'ADMIN',
      isPrimaryOwner: false,
    },
    {
      key: 'cashier',
      email: `cajero@${domain}`,
      name: 'Sofía Herrera',
      role: 'CASHIER',
      isPrimaryOwner: false,
    },
    {
      key: 'inventory',
      email: `inventario@${domain}`,
      name: 'Juan Camilo Restrepo',
      role: 'INVENTORY_USER',
      isPrimaryOwner: false,
    },
    {
      // Was the MEMBER demo user until that role was retired. The email stays so
      // re-seeding an existing sandbox (which never updates rows) does not add a
      // second copy of this person beside the migrated membership.
      key: 'secondCashier',
      email: `miembro@${domain}`,
      name: 'Andrés Felipe Mora',
      role: 'CASHIER',
      isPrimaryOwner: false,
    },
  ];
}

function effectiveSalePrice(product: SandboxProductPlan): number {
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

function buildProducts(): SandboxProductPlan[] {
  return PRODUCTS.map((definition) => ({
    sku: definition.sku,
    barcode: definition.barcode,
    name: definition.name,
    categoryName: definition.categoryName,
    description:
      definition.type === 'SERVICE'
        ? 'Servicio prestado en el local'
        : 'Producto de demostración para la organización sandbox',
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

function buildPurchaseOrders(
  products: SandboxProductPlan[],
  suppliers: SandboxSupplierPlan[],
  now: Date,
): SandboxPurchaseOrderPlan[] {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const supplierByDocument = new Map(
    suppliers.map((supplier) => [supplier.documentNumber, supplier]),
  );

  const definitions: {
    key: string;
    notes: string;
    supplierDocument: string;
    status: PlanPurchaseOrderStatus;
    daysAgo: number;
    confirmedDaysAgo: number | null;
    receivedDaysAgo: number | null;
    lines: { sku: string; qtyOrdered: number; qtyReceived: number }[];
  }[] = [
    {
      key: 'draft',
      notes: '[sandbox] Reposición de bebidas',
      supplierDocument: '900123456-1',
      status: 'DRAFT',
      daysAgo: 3,
      confirmedDaysAgo: null,
      receivedDaysAgo: null,
      lines: [
        { sku: 'BEB-001', qtyOrdered: 24, qtyReceived: 0 },
        { sku: 'BEB-004', qtyOrdered: 18, qtyReceived: 0 },
      ],
    },
    {
      key: 'pending',
      notes: '[sandbox] Pedido de aseo mensual',
      supplierDocument: '900765432-2',
      status: 'PENDING',
      daysAgo: 6,
      confirmedDaysAgo: 5,
      receivedDaysAgo: null,
      lines: [
        { sku: 'ASE-002', qtyOrdered: 30, qtyReceived: 0 },
        { sku: 'ASE-004', qtyOrdered: 12, qtyReceived: 0 },
      ],
    },
    {
      key: 'partial',
      notes: '[sandbox] Pedido parcial de alimentos',
      supplierDocument: '900321654-3',
      status: 'PARTIAL_RECEIVED',
      daysAgo: 9,
      confirmedDaysAgo: 8,
      receivedDaysAgo: 7,
      lines: [
        { sku: 'ALI-003', qtyOrdered: 24, qtyReceived: 24 },
        { sku: 'ALI-004', qtyOrdered: 20, qtyReceived: 8 },
      ],
    },
    {
      key: 'received',
      notes: '[sandbox] Compra de electrónica',
      supplierDocument: '901543210-4',
      status: 'RECEIVED',
      daysAgo: 12,
      confirmedDaysAgo: 11,
      receivedDaysAgo: 10,
      lines: [
        { sku: 'ELE-002', qtyOrdered: 8, qtyReceived: 8 },
        { sku: 'ELE-005', qtyOrdered: 20, qtyReceived: 20 },
      ],
    },
  ];

  const orders = definitions.map((definition): SandboxPurchaseOrderPlan => {
    const supplier = supplierByDocument.get(definition.supplierDocument);
    if (!supplier) {
      throw new Error(`Unknown supplier ${definition.supplierDocument}`);
    }

    const items = definition.lines.map((line): SandboxPurchaseOrderItemPlan => {
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
    });

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
      subtotal,
      taxAmount,
      total: round2(subtotal + taxAmount),
      items,
    };
  });

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

function buildSales(
  products: SandboxProductPlan[],
  customers: SandboxCustomerPlan[],
  users: SandboxUserPlan[],
  now: Date,
  asOf: Date,
): SandboxSalePlan[] {
  const random = createRandom(20261106);
  const sellable = products.filter(
    (product) => product.tracksStock || product.type === 'SERVICE',
  );
  const sales: SandboxSalePlan[] = [];
  const sellerKeys = users
    .filter((user) =>
      ['owner', 'admin', 'cashier', 'secondCashier'].includes(user.key),
    )
    .map((user) => user.key);
  let saleNumber = 1;

  for (let daysAgo = 74; daysAgo >= 0; daysAgo -= 1) {
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
      const items: SandboxSaleItemPlan[] = selected.map((product) => {
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

      let payments: SandboxSalePaymentPlan[];
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
        userKey: pickOne(sellerKeys, random),
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
  suppliers: SandboxSupplierPlan[],
  purchaseOrders: SandboxPurchaseOrderPlan[],
): SandboxExpensePlan[] {
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
    payments: SandboxExpensePaymentPlan[],
    supplierKey: string | null = null,
    purchaseOrderKey: string | null = null,
  ): SandboxExpensePlan => ({
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

  return [
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
      'Compra de electrónica para reposición',
      10,
      receivedOrder.total,
      'PAID',
      [{ daysAgo: 10, amount: receivedOrder.total, method: 'TRANSFER' }],
      receivedOrder.supplierKey,
      receivedOrder.key,
    ),
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
): SandboxEmployeePlan[] {
  const dayShifts = (
    startDaysAgo: number,
    shiftAmount: number,
    skipWeekday: number | null,
    description: string,
  ): SandboxEmployeeShiftPlan[] => {
    const shifts: SandboxEmployeeShiftPlan[] = [];
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
  employees: SandboxEmployeePlan[],
  now: Date,
): SandboxPayrollPlan[] {
  const byKey = new Map(employees.map((employee) => [employee.key, employee]));
  const requireEmployee = (key: string): SandboxEmployeePlan => {
    const employee = byKey.get(key);
    if (!employee) throw new Error(`Unknown employee ${key}`);
    return employee;
  };

  const group = (key: string, employeeKey: string): SandboxPayrollPlan => {
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
  counterparty: SandboxMoneyLoanPlan['counterparty'];
  collections: { daysAgo: number; amount: number; method: PlanPaymentMethod }[];
  closedDaysAgo: number | null;
}

function buildMoneyLoans(
  customers: SandboxCustomerPlan[],
  suppliers: SandboxSupplierPlan[],
  now: Date,
): SandboxMoneyLoanPlan[] {
  const customer = (
    documentNumber: string,
  ): SandboxMoneyLoanPlan['counterparty'] => {
    if (!customers.some((row) => row.documentNumber === documentNumber)) {
      throw new Error(`Unknown customer ${documentNumber}`);
    }
    return { kind: 'customer', documentNumber };
  };
  const supplier = (
    documentNumber: string,
  ): SandboxMoneyLoanPlan['counterparty'] => {
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
      key: 'user-cashier',
      type: 'MONEY',
      amount: 200000,
      issuedDaysAgo: 30,
      dueDaysAgo: -30,
      reason: 'Préstamo de demostración a empleado',
      counterparty: { kind: 'user', userKey: 'cashier' },
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
    const events: SandboxMoneyLoanEventPlan[] = [
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
      const paymentStatus: SandboxLoanResult['paymentStatus'] =
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
        requestKey: `sandbox-${seed.key}-collect-${index + 1}`,
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
        requestKey: `sandbox-${seed.key}-close`,
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

function buildTasks(): SandboxTaskPlan[] {
  return [
    {
      key: 'stock-drinks',
      title: 'Revisar stock de bebidas',
      description: 'Confirmar el conteo físico antes del pedido semanal.',
      status: 'PENDING',
      assignedTo: 'inventory',
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
      assignedTo: 'cashier',
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
      assignedTo: 'owner',
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

/**
 * Proofs the runner relies on. Kept exported so the focused test can run the
 * exact same checks over a fully built plan, including a fixed `now`.
 */
export function assertSandboxPlan(plan: SandboxSeedPlan): void {
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
      if (received !== 0)
        throw new Error(`Order ${order.key} should not be received`);
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
    if (!employee)
      throw new Error(`Unknown payroll employee ${payroll.employeeKey}`);
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

// ─── Entry point ───────────────────────────────────────────────────────────

export function buildSandboxSeedPlan(input: SandboxSeedInput): SandboxSeedPlan {
  const asOf = input.now ?? new Date();
  const now = startOfUtcDay(asOf);
  const users = buildUsers(input);
  const products = buildProducts();
  const purchaseOrders = buildPurchaseOrders(products, SUPPLIERS, now);
  const sales = buildSales(products, CUSTOMERS, users, now, asOf);
  const expenses = buildExpenses(SUPPLIERS, purchaseOrders);
  const employees = buildEmployees(now, input.staffEmailDomain);
  const payroll = buildPayroll(employees, now);
  const moneyLoans = buildMoneyLoans(CUSTOMERS, SUPPLIERS, now);
  const tasks = buildTasks();

  const plan: SandboxSeedPlan = {
    organization: {
      name: input.organizationName,
      slug: input.organizationSlug,
      taxId: '901234567-8',
      phone: '6015550101',
      address: 'Calle 100 #15-20, Bogotá',
      plan: 'PRO',
      status: 'ACTIVE',
      billingStatus: 'PAID',
      settings: {
        printHeader: input.organizationName,
        printFooter: 'Gracias por su compra',
      },
      sequences: [
        { type: 'SALE', prefix: 'REC' },
        { type: 'PO', prefix: 'OC' },
      ],
      cashRegisters: ['Caja Principal', 'Caja Secundaria'],
    },
    users,
    categories: [...CATEGORIES],
    products,
    customers: [...CUSTOMERS],
    suppliers: [...SUPPLIERS],
    purchaseOrders,
    sales,
    expenses,
    employees,
    payroll,
    moneyLoans,
    tasks,
  };

  assertSandboxPlan(plan);
  return plan;
}

/** Human-readable count summary used by the CLI before and after applying. */
export function summarizeSandboxPlan(plan: SandboxSeedPlan): string[] {
  return [
    `organization: ${plan.organization.name} (${plan.organization.slug})`,
    `users: ${plan.users.length}`,
    `categories: ${plan.categories.length}`,
    `products: ${plan.products.length}`,
    `customers: ${plan.customers.length}`,
    `suppliers: ${plan.suppliers.length}`,
    `purchase orders: ${plan.purchaseOrders.length}`,
    `sales: ${plan.sales.length}`,
    `expenses: ${plan.expenses.length}`,
    `employees: ${plan.employees.length}`,
    `employee shifts: ${plan.employees.reduce((sum, employee) => sum + employee.shifts.length, 0)}`,
    `payroll obligations: ${plan.payroll.length}`,
    `money loans: ${plan.moneyLoans.length}`,
    `money loan events: ${plan.moneyLoans.reduce((sum, loan) => sum + loan.events.length, 0)}`,
    `tasks: ${plan.tasks.length}`,
  ];
}
