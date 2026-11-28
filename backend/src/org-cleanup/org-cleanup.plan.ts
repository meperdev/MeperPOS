import { createHash } from 'node:crypto';

/**
 * Pure plan for the guarded organization cleanup (`prisma/cleanup-orgs.ts`).
 *
 * This module decides WHAT is deleted and WHY a run is refused. It never opens a
 * database: every refusal, the orphan-user computation, the confirmation phrase
 * and the deletion order can be tested without PostgreSQL. The CLI decides WHEN
 * and HOW those rows are removed.
 *
 * Two invariants shape the whole file:
 *  - a refused plan describes no deletion at all, so no caller can execute one
 *    by ignoring the refusal list;
 *  - the deletion order is a fixed children-first list, because the schema
 *    enforces RESTRICT on the payroll, loan, POS-loan and fiscal relations.
 */

/** Names no run may ever delete, whatever the environment says. */
export const BUILT_IN_PROTECTED_ORG_NAMES: readonly string[] = ['Motors Club'];

export const CLEANUP_USAGE =
  '--org <id> [--org <id>]... [--delete-user <email>]... [--apply]';

export type CleanupScope =
  | 'organization'
  | 'organization-or-whatsapp-connection'
  | 'whatsapp-connection'
  | 'whatsapp-conversation';

export interface CleanupTableStep {
  readonly table: string;
  readonly label: string;
  readonly scope: CleanupScope;
}

/**
 * Children first, then the parents they restrict. `FiscalDocument` is absent on
 * purpose: a target that holds one is refused, never deleted. `Organization`
 * itself is deleted last by the caller, after every list below is empty.
 *
 * The loan, POS-loan and payroll history tables carry BEFORE DELETE triggers
 * that reject ordinary deletes. The caller disables exactly the triggers in
 * `DELETE_BLOCKING_TRIGGERS` inside the transaction (the only mechanism a
 * non-superuser table owner has on Supabase), then re-enables them before
 * COMMIT; the foreign keys and every other trigger stay active the whole time,
 * so this list must be complete and the caller verifies that no
 * `organizationId`-scoped row is left before committing.
 */
export const ORG_CLEANUP_STEPS: readonly CleanupTableStep[] = [
  {
    table: 'PayrollAllocationVoid',
    label: 'payroll allocation voids',
    scope: 'organization',
  },
  {
    table: 'PayrollCashReturn',
    label: 'payroll cash returns',
    scope: 'organization',
  },
  {
    table: 'PayrollCashRevision',
    label: 'payroll cash revisions',
    scope: 'organization',
  },
  {
    table: 'PayrollAllocation',
    label: 'payroll allocations',
    scope: 'organization',
  },
  {
    table: 'PayrollInstallmentReference',
    label: 'payroll installment references',
    scope: 'organization',
  },
  {
    table: 'PayrollShiftMembership',
    label: 'payroll shift memberships',
    scope: 'organization',
  },
  {
    table: 'PayrollInstallment',
    label: 'payroll installments',
    scope: 'organization',
  },
  {
    table: 'PayrollObligationExpense',
    label: 'payroll obligation expenses',
    scope: 'organization',
  },
  {
    table: 'PayrollCashOutflow',
    label: 'payroll cash outflows',
    scope: 'organization',
  },
  {
    table: 'PayrollObligation',
    label: 'payroll obligations',
    scope: 'organization',
  },
  { table: 'EmployeeShift', label: 'employee shifts', scope: 'organization' },
  { table: 'Employee', label: 'employees', scope: 'organization' },
  {
    table: 'PayrollExpenseCategory',
    label: 'payroll expense categories',
    scope: 'organization',
  },
  { table: 'ExpensePayment', label: 'expense payments', scope: 'organization' },
  { table: 'Expense', label: 'expenses', scope: 'organization' },
  { table: 'ExpenseLabel', label: 'expense labels', scope: 'organization' },
  { table: 'ExpenseGroup', label: 'expense groups', scope: 'organization' },
  {
    table: 'InventoryMovement',
    label: 'inventory movements',
    scope: 'organization',
  },
  {
    table: 'InventoryLoanEvent',
    label: 'inventory loan events',
    scope: 'organization',
  },
  {
    table: 'InventoryLoanOperation',
    label: 'inventory loan operations',
    scope: 'organization',
  },
  {
    table: 'InventoryLoanItem',
    label: 'inventory loan items',
    scope: 'organization',
  },
  { table: 'InventoryLoan', label: 'inventory loans', scope: 'organization' },
  {
    table: 'PosLoanSaleReservation',
    label: 'POS loan reservations',
    scope: 'organization',
  },
  {
    table: 'PosLoanSaleIntentOriginSite',
    label: 'POS loan intent origin sites',
    scope: 'organization',
  },
  {
    table: 'PosLoanSaleIntent',
    label: 'POS loan intents',
    scope: 'organization',
  },
  {
    table: 'SaleOriginSite',
    label: 'sale origin sites',
    scope: 'organization',
  },
  { table: 'SaleItem', label: 'sale items', scope: 'organization' },
  { table: 'Payment', label: 'sale payments', scope: 'organization' },
  { table: 'Sale', label: 'sales', scope: 'organization' },
  {
    table: 'MoneyLoanEvent',
    label: 'money loan events',
    scope: 'organization',
  },
  { table: 'MoneyLoan', label: 'money loans', scope: 'organization' },
  {
    table: 'PurchaseOrderItem',
    label: 'purchase order items',
    scope: 'organization',
  },
  { table: 'PurchaseOrder', label: 'purchase orders', scope: 'organization' },
  {
    table: 'StockTransferItem',
    label: 'stock transfer items',
    scope: 'organization',
  },
  { table: 'StockTransfer', label: 'stock transfers', scope: 'organization' },
  { table: 'ProductStock', label: 'product stocks', scope: 'organization' },
  {
    table: 'ProductStockAlertEvent',
    label: 'stock alert events',
    scope: 'organization',
  },
  { table: 'ProductStockAlert', label: 'stock alerts', scope: 'organization' },
  { table: 'Product', label: 'products', scope: 'organization' },
  { table: 'Category', label: 'categories', scope: 'organization' },
  {
    table: 'CustomerVehicle',
    label: 'customer vehicles',
    scope: 'organization',
  },
  { table: 'Customer', label: 'customers', scope: 'organization' },
  { table: 'Supplier', label: 'suppliers', scope: 'organization' },
  {
    table: 'MembershipLocation',
    label: 'membership site assignments',
    scope: 'organization',
  },
  {
    table: 'OrganizationUser',
    label: 'organization memberships',
    scope: 'organization',
  },
  // Session rows carry an organizationId but no foreign key, so nothing cascades
  // them; a token scoped to a deleted organization is removed with it.
  {
    table: 'RefreshToken',
    label: 'refresh sessions',
    scope: 'organization',
  },
  {
    table: 'OrganizationSequence',
    label: 'organization sequences',
    scope: 'organization',
  },
  { table: 'CashRegister', label: 'cash registers', scope: 'organization' },
  { table: 'TaskEvent', label: 'task events', scope: 'organization' },
  { table: 'Task', label: 'tasks', scope: 'organization' },
  { table: 'AuditLog', label: 'audit log rows', scope: 'organization' },
  { table: 'PaymentRecord', label: 'payment records', scope: 'organization' },
  {
    table: 'WhatsAppDelivery',
    label: 'WhatsApp deliveries',
    scope: 'whatsapp-connection',
  },
  {
    table: 'WhatsAppMessage',
    label: 'WhatsApp messages',
    scope: 'whatsapp-conversation',
  },
  {
    table: 'WhatsAppConversation',
    label: 'WhatsApp conversations',
    scope: 'organization-or-whatsapp-connection',
  },
  {
    table: 'WhatsAppProcessedEvent',
    label: 'WhatsApp processed events',
    scope: 'whatsapp-connection',
  },
  {
    table: 'WhatsAppInternalContact',
    label: 'WhatsApp internal contacts',
    scope: 'organization',
  },
  {
    table: 'WhatsAppIdentity',
    label: 'WhatsApp identities',
    scope: 'organization',
  },
  {
    table: 'WhatsAppLinkChallenge',
    label: 'WhatsApp link challenges',
    scope: 'organization',
  },
  {
    table: 'WhatsAppConnection',
    label: 'WhatsApp connections',
    scope: 'organization',
  },
  {
    table: 'OrganizationModule',
    label: 'organization modules',
    scope: 'organization',
  },
  { table: 'Location', label: 'locations', scope: 'organization' },
];

// ─── Delete-trigger guard ──────────────────────────────────────────────────

export interface CleanupTriggerGuard {
  readonly table: string;
  readonly trigger: string;
  /**
   * The table whose target rows make this trigger fire on the delete, when it
   * is not `table` itself. `InventoryMovement_inventory_loan_immutable` only
   * rejects loan movements, which exist only for organizations with inventory
   * loans, so a cleanup without loans never locks `InventoryMovement` (every
   * POS sale writes to it). Should a loan movement exist without a loan, the
   * trigger stays enabled, raises, and the whole transaction rolls back.
   */
  readonly neededWhenRowsIn?: string;
}

/**
 * The migration-installed triggers that reject the deletions this tool must
 * perform. Each one guards history that a whole-tenant cleanup legitimately
 * removes, so the caller disables it for the duration of the transaction and
 * re-enables it before COMMIT. The list is static and validated at run time: a
 * missing entry, an unexpected DELETE trigger on a table the plan deletes from,
 * or a table the connected role does not own refuses the run before any write.
 *
 * Verified against `backend/prisma/migrations` (16 triggers):
 * `MoneyLoanEvent_append_only`; the inventory-loan evidence triggers
 * (`InventoryLoanEvent_append_only`, `InventoryLoan_identity`,
 * `InventoryLoanItem_evidence`, `InventoryLoanOperation_immutable`,
 * `InventoryMovement_inventory_loan_immutable`); the POS-loan pair
 * (`PosLoanSaleIntent_protect`, `PosLoanSaleReservation_validate`); and the
 * payroll history/identity triggers.
 */
export const DELETE_BLOCKING_TRIGGERS: readonly CleanupTriggerGuard[] = [
  { table: 'InventoryLoanEvent', trigger: 'InventoryLoanEvent_append_only' },
  { table: 'InventoryLoan', trigger: 'InventoryLoan_identity' },
  { table: 'InventoryLoanItem', trigger: 'InventoryLoanItem_evidence' },
  {
    table: 'InventoryLoanOperation',
    trigger: 'InventoryLoanOperation_immutable',
  },
  {
    table: 'InventoryMovement',
    trigger: 'InventoryMovement_inventory_loan_immutable',
    neededWhenRowsIn: 'InventoryLoan',
  },
  { table: 'MoneyLoanEvent', trigger: 'MoneyLoanEvent_append_only' },
  { table: 'PayrollAllocation', trigger: 'PayrollAllocation_history' },
  { table: 'PayrollAllocationVoid', trigger: 'PayrollAllocationVoid_history' },
  { table: 'PayrollCashOutflow', trigger: 'PayrollCashOutflow_identity' },
  { table: 'PayrollCashReturn', trigger: 'PayrollCashReturn_history' },
  { table: 'PayrollCashRevision', trigger: 'PayrollCashRevision_history' },
  {
    table: 'PayrollInstallmentReference',
    trigger: 'PayrollInstallmentReference_history',
  },
  {
    table: 'PayrollObligationExpense',
    trigger: 'PayrollObligationExpense_history',
  },
  {
    table: 'PayrollShiftMembership',
    trigger: 'PayrollShiftMembership_history',
  },
  { table: 'PosLoanSaleIntent', trigger: 'PosLoanSaleIntent_protect' },
  {
    table: 'PosLoanSaleReservation',
    trigger: 'PosLoanSaleReservation_validate',
  },
];

/**
 * DELETE triggers that stay enabled on purpose because they only keep the
 * aggregate consistent with the rows being deleted anyway.
 */
export const HARMLESS_DELETE_TRIGGERS: ReadonlyArray<
  CleanupTriggerGuard & { readonly reason: string }
> = [
  {
    table: 'ProductStock',
    trigger: 'ProductStock_aggregate_delta',
    reason:
      'it moves each site balance out of Product.stock/reservedStock before the product row is deleted, and it tolerates a product that is already gone',
  },
];

// ─── Arguments ─────────────────────────────────────────────────────────────

export interface CleanupArgs {
  readonly orgIds: string[];
  readonly deleteUserEmails: string[];
  readonly apply: boolean;
  /** Read-only post-run check; never combined with --apply. */
  readonly verify: boolean;
  /** Prisma transaction timeout, default 60 seconds. */
  readonly timeoutSeconds: number;
}

export const DEFAULT_TIMEOUT_SECONDS = 60;

export type CleanupArgsResult =
  | { readonly ok: true; readonly args: CleanupArgs }
  | { readonly ok: false; readonly message: string };

function unknownArgument(token: string): CleanupArgsResult {
  return {
    ok: false,
    message: `unknown argument "${token}"; usage: ${CLEANUP_USAGE}`,
  };
}

/**
 * Parses `--org`, `--delete-user`, `--apply`, `--verify` and
 * `--timeout-seconds`. Dry run is the default: only the literal `--apply` flag
 * changes that, so a typo can never write.
 */
export function parseCleanupArgs(argv: readonly string[]): CleanupArgsResult {
  const orgIds: string[] = [];
  const deleteUserEmails: string[] = [];
  let apply = false;
  let verify = false;
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      apply = true;
      continue;
    }
    if (token === '--verify') {
      verify = true;
      continue;
    }
    if (
      token !== '--org' &&
      token !== '--delete-user' &&
      token !== '--timeout-seconds'
    ) {
      return unknownArgument(token);
    }
    const value = argv[index + 1];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      return { ok: false, message: `${token} needs a value` };
    }
    index += 1;
    if (token === '--org') {
      const id = value.trim();
      if (!orgIds.includes(id)) orgIds.push(id);
    } else if (token === '--delete-user') {
      const email = value.trim().toLowerCase();
      if (!deleteUserEmails.includes(email)) deleteUserEmails.push(email);
    } else {
      const parsed = Number(value.trim());
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 86_400) {
        return {
          ok: false,
          message: '--timeout-seconds needs an integer between 1 and 86400',
        };
      }
      timeoutSeconds = parsed;
    }
  }

  if (orgIds.length === 0) {
    return {
      ok: false,
      message:
        'no target organization was given: pass --org <id> at least once',
    };
  }
  if (verify && apply) {
    return { ok: false, message: '--verify and --apply cannot be combined' };
  }
  if (verify && deleteUserEmails.length > 0) {
    return { ok: false, message: '--verify does not take --delete-user' };
  }

  return {
    ok: true,
    args: { orgIds, deleteUserEmails, apply, verify, timeoutSeconds },
  };
}

// ─── Names, protection and the confirmation phrase ─────────────────────────

/** Splits a comma-separated environment value, trimming and dropping blanks. */
export function parseCommaList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Case and whitespace insensitive identity for an organization name. */
export function normalizeOrgName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The built-in protected names plus `CLEANUP_PROTECT_ORGS`, de-duplicated. */
export function protectedNameList(extra: string | undefined | null): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of [
    ...BUILT_IN_PROTECTED_ORG_NAMES,
    ...parseCommaList(extra),
  ]) {
    const key = normalizeOrgName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Returns the protected names a set of target names collides with. */
export function findProtectedTargets(
  names: readonly string[],
  protectedNames: readonly string[],
): string[] {
  const targets = new Set(names.map(normalizeOrgName));
  return protectedNames.filter((name) => targets.has(normalizeOrgName(name)));
}

/** The exact phrase `CLEANUP_CONFIRM` must carry for this run. */
export function expectedConfirmation(names: readonly string[]): string {
  return names.join(',');
}

/** Confirmation is exact, apart from the whitespace around the whole value. */
export function confirmationMatches(
  names: readonly string[],
  supplied: string | undefined,
): boolean {
  if (supplied === undefined) return false;
  return supplied.trim() === expectedConfirmation(names);
}

// ─── Environment gate ──────────────────────────────────────────────────────

export interface CleanupEnvironmentGate {
  readonly nodeEnv: string | undefined;
  readonly allowNonDev: boolean;
}

/** Outside development/test the run needs the explicit non-development opt-in. */
export function environmentGateRefusal(
  gate: CleanupEnvironmentGate,
): string | null {
  if (gate.nodeEnv === 'development' || gate.nodeEnv === 'test') return null;
  if (gate.allowNonDev) return null;
  return `NODE_ENV is "${gate.nodeEnv ?? 'undefined'}", so this cleanup needs CLEANUP_ALLOW_NON_DEV=true`;
}

// ─── Snapshot and plan ─────────────────────────────────────────────────────

export interface CleanupOrgRecord {
  readonly id: string;
  readonly name: string;
}

export interface CleanupTableCount {
  readonly table: string;
  readonly label: string;
  readonly count: number;
}

export interface CleanupExternalLeftovers {
  readonly logoUrl: string | null;
  readonly productImages: ReadonlyArray<{
    readonly productId: string;
    readonly name: string;
    readonly imageUrl: string;
  }>;
  readonly whatsAppConnections: ReadonlyArray<{
    readonly sessionName: string;
    readonly channel: string;
    readonly status: string;
  }>;
}

export interface CleanupOrgSnapshot extends CleanupOrgRecord {
  readonly fiscalDocumentCount: number;
  readonly counts: readonly CleanupTableCount[];
  readonly leftovers: CleanupExternalLeftovers;
}

export interface CleanupUserSnapshot {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isSuperAdmin: boolean;
  readonly active: boolean;
  readonly memberships: ReadonlyArray<{ readonly organizationId: string }>;
  /**
   * Rows outside the targets that reference this user through a RESTRICT
   * foreign key (`Task.createdBy`, `Expense.createdBy`, ...). Deleting the user
   * would abort the transaction, so the plan refuses instead.
   */
  readonly blockingReferences: ReadonlyArray<{
    readonly table: string;
    readonly count: number;
  }>;
}

export interface CleanupDeleteUserLookup {
  readonly email: string;
  readonly user: CleanupUserSnapshot | null;
}

export interface CleanupTriggerState extends CleanupTriggerGuard {
  /** `pg_trigger.tgenabled = 'O'`: the trigger fires on this database. */
  readonly enabled: boolean;
}

export interface CleanupTriggerAudit {
  /** The role the catalogue was read as (`current_user`). */
  readonly role: string;
  /** Tables the plan deletes from. */
  readonly deletedTables: readonly string[];
  /** Every non-internal DELETE trigger found on those tables. */
  readonly found: readonly CleanupTriggerState[];
  /** `DELETE_BLOCKING_TRIGGERS` entries that do not exist in this database. */
  readonly missing: readonly CleanupTriggerGuard[];
  /** `DELETE_BLOCKING_TRIGGERS` entries that are not `'O'` before the run. */
  readonly disabled: readonly CleanupTriggerGuard[];
  /** Enabled DELETE triggers neither listed nor known harmless. */
  readonly unexpected: readonly CleanupTriggerGuard[];
  /** Tables whose triggers must be disabled that the connected role does not own. */
  readonly unowned: ReadonlyArray<{
    readonly table: string;
    readonly role: string;
  }>;
}

export interface CleanupSnapshot {
  /** What the database says about the triggers the run needs. */
  readonly triggers: CleanupTriggerAudit;
  /** Every organization in the database, for name lookups. */
  readonly organizations: readonly CleanupOrgRecord[];
  /** The requested organizations that exist, in the requested order. */
  readonly targets: readonly CleanupOrgSnapshot[];
  readonly unknownOrgIds: readonly string[];
  /** Members of at least one target organization. */
  readonly candidates: readonly CleanupUserSnapshot[];
  readonly deleteUsers: readonly CleanupDeleteUserLookup[];
  readonly activeSuperAdminIds: readonly string[];
  /**
   * Tables that carry an `organizationId` but are not part of the delete plan,
   * with the rows they still hold for the targets. Non-empty refuses the run.
   */
  readonly unplannedScopedTables: ReadonlyArray<{
    readonly table: string;
    readonly count: number;
  }>;
}

export interface CleanupRequest {
  readonly orgIds: readonly string[];
  readonly deleteUserEmails: readonly string[];
  readonly apply: boolean;
  readonly confirmation: string | undefined;
  readonly protectedNames: readonly string[];
}

export interface CleanupKeptUser {
  readonly user: CleanupUserSnapshot;
  readonly keptOrganizationNames: readonly string[];
}

export interface CleanupPlan {
  readonly apply: boolean;
  readonly protectedNames: readonly string[];
  readonly role: string;
  readonly triggers: CleanupTriggerAudit;
  readonly orgs: readonly CleanupOrgSnapshot[];
  readonly confirmation: string;
  readonly orphans: readonly CleanupUserSnapshot[];
  readonly requestedUsers: readonly CleanupUserSnapshot[];
  readonly deleteUsers: readonly CleanupUserSnapshot[];
  readonly keptUsers: readonly CleanupKeptUser[];
  readonly activeSuperAdminIds: readonly string[];
  readonly rowsToDelete: number;
  readonly refusals: readonly string[];
}

function describeReferences(
  references: CleanupUserSnapshot['blockingReferences'],
): string {
  return references.map((ref) => `${ref.table}: ${ref.count}`).join(', ');
}

function quoteList(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(', ');
}

/**
 * Computes the whole plan for one run. Refusals are collected first; a refused
 * plan carries no deletion set, so `applyCleanup` can only ever execute an
 * empty one.
 */
export function planCleanup(
  request: CleanupRequest,
  snapshot: CleanupSnapshot,
): CleanupPlan {
  const refusals: string[] = [];
  const orgs = snapshot.targets;
  const targetIds = new Set(orgs.map((org) => org.id));
  const targetNames = orgs.map((org) => org.name);
  const organizationsById = new Map(
    snapshot.organizations.map((org) => [org.id, org]),
  );

  for (const id of snapshot.unknownOrgIds) {
    refusals.push(`organization id "${id}" does not exist`);
  }

  for (const name of findProtectedTargets(
    targetNames,
    request.protectedNames,
  )) {
    refusals.push(
      `organization "${name}" is protected and will never be deleted`,
    );
  }

  for (const name of targetNames) {
    if (name.includes(',')) {
      refusals.push(
        `target organization names must not contain commas: "${name}" makes CLEANUP_CONFIRM ambiguous`,
      );
    }
  }

  for (const org of orgs) {
    if (org.fiscalDocumentCount > 0) {
      refusals.push(
        `target organization "${org.name}" holds ${org.fiscalDocumentCount} fiscal documents (legal records); refusing`,
      );
    }
  }

  for (const lookup of snapshot.deleteUsers) {
    if (!lookup.user) {
      refusals.push(`user "${lookup.email}" does not exist`);
    }
  }

  for (const lookup of snapshot.deleteUsers) {
    if (!lookup.user) continue;
    const kept = lookup.user.memberships
      .filter((membership) => !targetIds.has(membership.organizationId))
      .map(
        (membership) =>
          organizationsById.get(membership.organizationId)?.name ??
          membership.organizationId,
      );
    if (kept.length > 0) {
      refusals.push(
        `user "${lookup.user.email}" still belongs to organization ${quoteList(kept)}, which is not a target; remove that membership first`,
      );
    }
  }

  const orphans: CleanupUserSnapshot[] = [];
  const deleteById = new Map<string, CleanupUserSnapshot>();
  for (const candidate of snapshot.candidates) {
    // A user without any membership is not an orphan: it is only deleted when
    // `--delete-user` names it explicitly.
    if (candidate.memberships.length === 0) continue;
    const staysSomewhere = candidate.memberships.some(
      (membership) => !targetIds.has(membership.organizationId),
    );
    if (staysSomewhere) continue;
    orphans.push(candidate);
    deleteById.set(candidate.id, candidate);
  }

  const requestedUsers: CleanupUserSnapshot[] = [];
  for (const lookup of snapshot.deleteUsers) {
    if (!lookup.user) continue;
    if (!deleteById.has(lookup.user.id)) {
      requestedUsers.push(lookup.user);
    }
    deleteById.set(lookup.user.id, lookup.user);
  }

  for (const user of deleteById.values()) {
    if (user.blockingReferences.length > 0) {
      refusals.push(
        `user "${user.email}" still owns data outside the targets (${describeReferences(user.blockingReferences)}); refusing`,
      );
    }
  }

  const remainingSuperAdmins = snapshot.activeSuperAdminIds.filter(
    (id) => !deleteById.has(id),
  );
  if (remainingSuperAdmins.length === 0) {
    for (const user of deleteById.values()) {
      if (!user.isSuperAdmin || !user.active) continue;
      refusals.push(
        `user "${user.email}" would be the last active SuperAdmin; refusing`,
      );
    }
  }

  const confirmation = expectedConfirmation(targetNames);
  if (request.apply) {
    if (
      request.confirmation === undefined ||
      request.confirmation.trim() === ''
    ) {
      refusals.push(
        `CLEANUP_CONFIRM is required with --apply: expected "${confirmation}"`,
      );
    } else if (!confirmationMatches(targetNames, request.confirmation)) {
      refusals.push(
        `CLEANUP_CONFIRM does not match the target names: expected "${confirmation}", received "${request.confirmation.trim()}"`,
      );
    }
  }

  for (const table of snapshot.unplannedScopedTables) {
    if (table.count <= 0) continue;
    refusals.push(
      `table "${table.table}" holds ${table.count} rows for the targets but is not part of the cleanup plan; refusing`,
    );
  }

  // The row deletes below need the history triggers off for a moment. Every
  // condition that would make that unsafe is a refusal before any write.
  for (const guard of snapshot.triggers.missing) {
    refusals.push(
      `trigger "${guard.trigger}" on table "${guard.table}" is missing from this database; refusing`,
    );
  }
  for (const guard of snapshot.triggers.disabled) {
    refusals.push(
      `trigger "${guard.trigger}" on table "${guard.table}" is not enabled before the run; refusing`,
    );
  }
  for (const guard of snapshot.triggers.unexpected) {
    refusals.push(
      `table "${guard.table}" has an unclassified DELETE trigger "${guard.trigger}"; refusing`,
    );
  }
  for (const table of snapshot.triggers.unowned) {
    refusals.push(
      `role "${table.role}" does not own table "${table.table}", so its triggers cannot be disabled; refusing`,
    );
  }

  const keptUsers: CleanupKeptUser[] = [];
  for (const candidate of snapshot.candidates) {
    if (deleteById.has(candidate.id)) continue;
    const keptOrganizationNames = candidate.memberships
      .filter((membership) => !targetIds.has(membership.organizationId))
      .map(
        (membership) =>
          organizationsById.get(membership.organizationId)?.name ??
          membership.organizationId,
      );
    keptUsers.push({ user: candidate, keptOrganizationNames });
  }

  const rowsToDelete = orgs.reduce(
    (total, org) =>
      total + org.counts.reduce((sum, entry) => sum + entry.count, 0),
    0,
  );

  const refused = refusals.length > 0;

  return {
    apply: request.apply,
    protectedNames: request.protectedNames,
    role: snapshot.triggers.role,
    triggers: snapshot.triggers,
    orgs,
    confirmation,
    orphans: refused ? [] : orphans,
    requestedUsers: refused ? [] : requestedUsers,
    deleteUsers: refused ? [] : [...deleteById.values()],
    keptUsers: refused ? [] : keptUsers,
    activeSuperAdminIds: snapshot.activeSuperAdminIds,
    rowsToDelete,
    refusals,
  };
}

// ─── Plan digest (dry run ↔ apply binding) ─────────────────────────────────

export interface CleanupPlanDigestFacts {
  readonly orgs: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly counts: ReadonlyArray<{
      readonly table: string;
      readonly count: number;
    }>;
  }>;
  readonly deleteUsers: ReadonlyArray<{
    readonly id: string;
    readonly email: string;
    readonly kind: 'orphan' | 'requested';
  }>;
  readonly keptUsers: readonly string[];
}

/**
 * Canonical sha256 over everything the operator approves in the dry run: the
 * target ids, names and per-table counts, every user that will be deleted (with
 * whether it is an orphan or an explicit request) and every user that will be
 * kept. `--apply` refuses unless `CLEANUP_PLAN_DIGEST` equals this value, both
 * for the plan computed at apply time and for the one re-derived under the
 * transaction's locks, so a dry run and its apply cannot diverge silently.
 */
export function planDigestOf(facts: CleanupPlanDigestFacts): string {
  const canonical = JSON.stringify({
    orgs: facts.orgs.map((org) => [
      org.id,
      org.name,
      org.counts.map((entry) => [entry.table, entry.count]),
    ]),
    deleteUsers: facts.deleteUsers.map((user) => [
      user.id,
      user.email,
      user.kind,
    ]),
    keptUsers: [...facts.keptUsers].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Digest of a whole plan, built from the facts an apply re-derives. */
export function planDigest(plan: CleanupPlan): string {
  return planDigestOf({
    orgs: plan.orgs.map((org) => ({
      id: org.id,
      name: org.name,
      counts: org.counts.map((entry) => ({
        table: entry.table,
        count: entry.count,
      })),
    })),
    deleteUsers: [
      ...plan.orphans.map((user) => ({
        id: user.id,
        email: user.email,
        kind: 'orphan' as const,
      })),
      ...plan.requestedUsers.map((user) => ({
        id: user.id,
        email: user.email,
        kind: 'requested' as const,
      })),
    ].sort((left, right) => left.id.localeCompare(right.id)),
    keptUsers: plan.keptUsers.map((entry) => entry.user.id).sort(),
  });
}

// ─── Trigger window ────────────────────────────────────────────────────────

function totalByTable(plan: CleanupPlan): Map<string, number> {
  const totals = new Map<string, number>();
  for (const org of plan.orgs) {
    for (const entry of org.counts) {
      totals.set(entry.table, (totals.get(entry.table) ?? 0) + entry.count);
    }
  }
  return totals;
}

/**
 * Tables this run deletes rows from. A row delete takes row locks only on the
 * target's rows, so other organizations keep writing to these tables; only the
 * tables in `triggersToDisable` are locked ACCESS EXCLUSIVE. A target with no
 * rows in a table never touches it.
 */
export function lockedTables(plan: CleanupPlan): string[] {
  const totals = totalByTable(plan);
  return ORG_CLEANUP_STEPS.map((step) => step.table).filter(
    (table) => (totals.get(table) ?? 0) > 0,
  );
}

/**
 * The history triggers that must be disabled: only those whose table is
 * actually locked by this run. A cleanup of an organization without inventory
 * loans never touches the inventory-loan evidence triggers.
 */
export function triggersToDisable(plan: CleanupPlan): CleanupTriggerGuard[] {
  const totals = totalByTable(plan);
  return DELETE_BLOCKING_TRIGGERS.filter(
    (guard) => (totals.get(guard.neededWhenRowsIn ?? guard.table) ?? 0) > 0,
  );
}

// ─── Failure and verification reporting ────────────────────────────────────

/** Quote a value for a POSIX shell, closing and reopening around each quote. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** An error raised before COMMIT: nothing was deleted. */
export function formatRollbackFailure(message: string): string {
  return `failed, transaction rolled back: ${message}`;
}

export interface CleanupPostCommitFailure {
  readonly organizations: number;
  readonly users: number;
  readonly failures: readonly string[];
}

/**
 * An error raised after COMMIT: the deletion stands and the operator must fix
 * it by hand. The text carries the SQL to inspect and re-enable the triggers.
 */
export function formatPostCommitFailure(
  failure: CleanupPostCommitFailure,
): string {
  const lines = [
    `COMMITTED: ${failure.organizations} organizations and ${failure.users} users were deleted; post-commit verification failed:`,
    ...failure.failures.map((entry) => `  - ${entry}`),
    'Inspect the history triggers with:',
    '  SELECT c.relname, t.tgname, t.tgenabled',
    '  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid',
    '  WHERE NOT t.tgisinternal AND (t.tgtype & 8) <> 0 ORDER BY 1, 2;',
    "Re-enable every row whose tgenabled is not 'O' with:",
    '  ALTER TABLE "<table>" ENABLE TRIGGER "<trigger>";',
  ];
  return lines.join('\n');
}

/** Exit code of a committed run: 2 when the post-commit check failed. */
export function postCommitExitCode(verification: {
  readonly failures: readonly string[];
}): number {
  return verification.failures.length > 0 ? 2 : 0;
}

export interface CleanupVerifyInput {
  readonly organizations: ReadonlyArray<{
    readonly id: string;
    readonly name: string | null;
  }>;
  readonly triggers: {
    readonly checked: number;
    readonly offenders: ReadonlyArray<{
      readonly table: string;
      readonly trigger: string;
    }>;
  };
}

/** Read-only `--verify` report: are the organizations gone and the triggers on? */
export function formatVerifyReport(input: CleanupVerifyInput): string {
  const lines = ['[cleanup-orgs] VERIFY — read only, nothing is written.'];
  for (const org of input.organizations) {
    lines.push(
      org.name === null
        ? `  - ${org.id}: gone`
        : `  - ${org.id}: still exists "${org.name}"`,
    );
  }
  lines.push(`History triggers enabled: ${input.triggers.checked} checked.`);
  for (const offender of input.triggers.offenders) {
    lines.push(`  - ${offender.table}.${offender.trigger}: DISABLED`);
  }
  return lines.join('\n');
}

export function verifySucceeded(input: CleanupVerifyInput): boolean {
  return (
    input.organizations.every((org) => org.name === null) &&
    input.triggers.offenders.length === 0
  );
}

// ─── Reports ───────────────────────────────────────────────────────────────

const LABEL_WIDTH = 34;

function formatCountLines(counts: readonly CleanupTableCount[]): string[] {
  return counts
    .filter((entry) => entry.count > 0)
    .map((entry) => `       ${entry.label.padEnd(LABEL_WIDTH)}${entry.count}`);
}

function formatTargetBlock(
  org: CleanupOrgSnapshot,
  position: number,
): string[] {
  const lines: string[] = [];
  const total = org.counts.reduce((sum, entry) => sum + entry.count, 0);
  lines.push(`  ${position}. ${org.name} (id ${org.id})`);
  lines.push(`     rows to delete: ${total}`);
  const counts = formatCountLines(org.counts);
  if (counts.length === 0) {
    lines.push('     nothing to delete');
  } else {
    lines.push(...counts);
  }

  const leftovers: string[] = [];
  if (org.leftovers.logoUrl) {
    leftovers.push(`       organization logo URL: ${org.leftovers.logoUrl}`);
  }
  for (const image of org.leftovers.productImages) {
    leftovers.push(
      `       product image URL: ${image.imageUrl} ("${image.name}")`,
    );
  }
  for (const connection of org.leftovers.whatsAppConnections) {
    leftovers.push(
      `       WhatsApp session "${connection.sessionName}" (${connection.channel}, ${connection.status})`,
    );
  }
  if (leftovers.length === 0) {
    lines.push('     no external leftovers');
  } else {
    lines.push('     external leftovers this tool cannot delete:');
    lines.push(...leftovers);
  }
  return lines;
}

/**
 * Renders the dry-run (or refused) report. It prints names, e-mails and
 * external URLs only: no password hash, token or other credential is ever part
 * of the snapshot, so none can leak here.
 */
export function formatPlanReport(plan: CleanupPlan): string {
  const lines: string[] = [];
  lines.push(
    plan.apply
      ? '[cleanup-orgs] APPLY — the plan below is executed in one transaction.'
      : '[cleanup-orgs] DRY RUN — no write was requested.',
  );
  lines.push(`Connected as role "${plan.role}".`);
  lines.push(`Targets (${plan.orgs.length}), in the given order:`);
  plan.orgs.forEach((org, index) => {
    lines.push(...formatTargetBlock(org, index + 1));
  });

  lines.push(
    `Users that become orphaned and will be deleted (${plan.orphans.length}):`,
  );
  for (const user of plan.orphans) {
    lines.push(`  - ${user.name} <${user.email}>`);
  }
  lines.push(`Users kept by another organization (${plan.keptUsers.length}):`);
  for (const kept of plan.keptUsers) {
    lines.push(
      `  - ${kept.user.name} <${kept.user.email}> keeps ${kept.keptOrganizationNames.join(', ')}`,
    );
  }
  lines.push(`Users deleted on request (${plan.requestedUsers.length}):`);
  for (const user of plan.requestedUsers) {
    lines.push(`  - ${user.name} <${user.email}>`);
  }

  const locked = lockedTables(plan);
  const triggers = triggersToDisable(plan);
  lines.push(
    `Tables deleted from (row locks on the targets' rows only): ${locked.length > 0 ? locked.join(', ') : 'none'}`,
  );
  const exclusive = [...new Set(triggers.map((guard) => guard.table))];
  lines.push(
    `Tables locked ACCESS EXCLUSIVE until COMMIT (history trigger disabled, ${triggers.length} of ${DELETE_BLOCKING_TRIGGERS.length}): ${exclusive.length > 0 ? exclusive.join(', ') : 'none'}`,
  );
  lines.push(
    'Run this in a low-traffic window: every writer to the ACCESS EXCLUSIVE tables, protected organizations included, waits until the transaction commits.',
  );
  lines.push(`Confirmation phrase for --apply: ${plan.confirmation}`);

  if (plan.refusals.length > 0) {
    lines.push('');
    lines.push(`Refused (${plan.refusals.length}):`);
    for (const refusal of plan.refusals) lines.push(`  - ${refusal}`);
    lines.push('nothing was written.');
  } else {
    const digest = planDigest(plan);
    lines.push(`CLEANUP_PLAN_DIGEST=${digest}`);
    if (!plan.apply) {
      lines.push('');
      lines.push(
        `Re-run with --apply, CLEANUP_CONFIRM=${shellQuote(plan.confirmation)} and CLEANUP_PLAN_DIGEST=${digest} to delete.`,
      );
    }
  }

  return lines.join('\n');
}

export interface CleanupRecountOrg {
  readonly orgId: string;
  readonly name: string;
  readonly counts: readonly CleanupTableCount[];
  readonly total: number;
}

export interface CleanupProtectedRecount {
  readonly id: string;
  readonly name: string;
  readonly counts: readonly CleanupTableCount[];
  readonly total: number;
}

/** Recount section: the same labels, now with what is left behind. */
export function formatRecountSection(
  title: string,
  orgs: readonly CleanupRecountOrg[],
): string {
  const lines: string[] = [title];
  for (const org of orgs) {
    lines.push(`  - ${org.name} (id ${org.orgId}): rows left ${org.total}`);
    for (const entry of org.counts) {
      if (entry.count === 0) continue;
      lines.push(`       ${entry.label.padEnd(LABEL_WIDTH)}${entry.count}`);
    }
  }
  return lines.join('\n');
}

/**
 * Before/after comparison of the protected organizations' row counts, one line
 * per organization. Callers add their own heading: after a commit this is
 * information, not a verdict.
 */
export function formatProtectedComparison(
  before: readonly CleanupProtectedRecount[],
  after: readonly CleanupProtectedRecount[],
): string {
  // Keyed by id, never by name: two organizations may share a name, and a
  // collapsed map would then hide a changed count behind an "unchanged" line.
  const afterById = new Map(after.map((org) => [org.id, org]));
  const lines: string[] = [];
  for (const org of before) {
    const now = afterById.get(org.id);
    if (!now) {
      lines.push(`  - ${org.name}: CHANGED (${org.total} -> missing)`);
    } else if (now.total === org.total) {
      lines.push(`  - ${org.name}: ${org.total} rows, unchanged`);
    } else {
      lines.push(`  - ${org.name}: CHANGED (${org.total} -> ${now.total})`);
    }
  }
  return lines.join('\n');
}
