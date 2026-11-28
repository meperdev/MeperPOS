import {
  BUILT_IN_PROTECTED_ORG_NAMES,
  DELETE_BLOCKING_TRIGGERS,
  HARMLESS_DELETE_TRIGGERS,
  ORG_CLEANUP_STEPS,
  formatPostCommitFailure,
  formatRollbackFailure,
  formatVerifyReport,
  lockedTables,
  planDigest,
  planDigestOf,
  postCommitExitCode,
  shellQuote,
  triggersToDisable,
  verifySucceeded,
  confirmationMatches,
  environmentGateRefusal,
  expectedConfirmation,
  findProtectedTargets,
  formatPlanReport,
  formatProtectedComparison,
  formatRecountSection,
  normalizeOrgName,
  parseCleanupArgs,
  parseCommaList,
  planCleanup,
  protectedNameList,
  type CleanupOrgSnapshot,
  type CleanupPlan,
  type CleanupRequest,
  type CleanupSnapshot,
  type CleanupTriggerAudit,
  type CleanupUserSnapshot,
} from './org-cleanup.plan';

// ─── Fixtures for the pure plan ────────────────────────────────────────────

function countMap(
  values: Record<string, number>,
): CleanupOrgSnapshot['counts'] {
  return ORG_CLEANUP_STEPS.map((step) => ({
    table: step.table,
    label: step.label,
    count: values[step.table] ?? 0,
  }));
}

function orgSnapshot(
  id: string,
  name: string,
  counts: Record<string, number> = {},
  extras: Partial<CleanupOrgSnapshot> = {},
): CleanupOrgSnapshot {
  return {
    id,
    name,
    fiscalDocumentCount: 0,
    counts: countMap(counts),
    leftovers: { logoUrl: null, productImages: [], whatsAppConnections: [] },
    ...extras,
  };
}

function userSnapshot(
  overrides: Partial<CleanupUserSnapshot> & { id: string; email: string },
): CleanupUserSnapshot {
  return {
    name: overrides.email.split('@')[0],
    isSuperAdmin: false,
    active: true,
    memberships: [],
    blockingReferences: [],
    ...overrides,
  };
}

function healthyTriggerAudit(
  overrides: Partial<CleanupTriggerAudit> = {},
): CleanupTriggerAudit {
  return {
    role: 'cleanup_owner',
    deletedTables: ORG_CLEANUP_STEPS.map((step) => step.table),
    found: DELETE_BLOCKING_TRIGGERS.map((guard) => ({
      ...guard,
      enabled: true,
    })),
    missing: [],
    disabled: [],
    unexpected: [],
    unowned: [],
    ...overrides,
  };
}

const PROTECTED_ID = 'org-motors-club';
const TARGET_A = 'org-target-a';
const TARGET_B = 'org-target-b';

function baseSnapshot(
  overrides: Partial<CleanupSnapshot> = {},
): CleanupSnapshot {
  return {
    organizations: [
      { id: PROTECTED_ID, name: 'Motors Club' },
      { id: TARGET_A, name: 'Prueba PRO' },
      { id: TARGET_B, name: 'Prueba BASIC' },
    ],
    targets: [
      orgSnapshot(TARGET_A, 'Prueba PRO', { Product: 3, Sale: 2 }),
      orgSnapshot(TARGET_B, 'Prueba BASIC'),
    ],
    unknownOrgIds: [],
    candidates: [],
    deleteUsers: [],
    activeSuperAdminIds: [],
    unplannedScopedTables: [],
    triggers: healthyTriggerAudit(),
    ...overrides,
  };
}

function request(overrides: Partial<CleanupRequest> = {}): CleanupRequest {
  return {
    orgIds: [TARGET_A, TARGET_B],
    deleteUserEmails: [],
    apply: false,
    confirmation: undefined,
    protectedNames: protectedNameList(undefined),
    ...overrides,
  };
}

function targetNames(plan: CleanupPlan): string[] {
  return plan.orgs.map((org) => org.name);
}

// ─── Argument parsing ──────────────────────────────────────────────────────

describe('parseCleanupArgs', () => {
  it('collects repeatable --org and --delete-user values in the given order', () => {
    const result = parseCleanupArgs([
      '--org',
      'aaa',
      '--delete-user',
      'Stray@Example.Test',
      '--org',
      'bbb',
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.orgIds).toEqual(['aaa', 'bbb']);
    expect(result.args.deleteUserEmails).toEqual(['stray@example.test']);
    expect(result.args.apply).toBe(false);
  });

  it('is a dry run unless --apply is present', () => {
    const dry = parseCleanupArgs(['--org', 'aaa']);
    const applied = parseCleanupArgs(['--org', 'aaa', '--apply']);

    expect(dry.ok && dry.args.apply).toBe(false);
    expect(applied.ok && applied.args.apply).toBe(true);
  });

  it('deduplicates repeated organization ids while keeping the first position', () => {
    const result = parseCleanupArgs([
      '--org',
      'bbb',
      '--org',
      'aaa',
      '--org',
      'bbb',
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.orgIds).toEqual(['bbb', 'aaa']);
  });

  it('refuses without a target organization', () => {
    const result = parseCleanupArgs([]);

    expect(result).toEqual({
      ok: false,
      message:
        'no target organization was given: pass --org <id> at least once',
    });
  });

  it('refuses an unknown argument', () => {
    const result = parseCleanupArgs(['--org', 'aaa', '--force']);

    expect(result).toEqual({
      ok: false,
      message:
        'unknown argument "--force"; usage: --org <id> [--org <id>]... [--delete-user <email>]... [--apply]',
    });
  });

  it('refuses an option without a value', () => {
    expect(parseCleanupArgs(['--org'])).toEqual({
      ok: false,
      message: '--org needs a value',
    });
    expect(parseCleanupArgs(['--org', 'aaa', '--delete-user'])).toEqual({
      ok: false,
      message: '--delete-user needs a value',
    });
    expect(parseCleanupArgs(['--org', '--apply'])).toEqual({
      ok: false,
      message: '--org needs a value',
    });
  });

  it('parses the read-only verify mode and its timeout', () => {
    const verify = parseCleanupArgs(['--verify', '--org', 'aaa']);
    const timed = parseCleanupArgs(['--org', 'aaa', '--timeout-seconds', '90']);

    expect(verify.ok && verify.args.verify).toBe(true);
    expect(verify.ok && verify.args.apply).toBe(false);
    expect(timed.ok && timed.args.timeoutSeconds).toBe(90);
    const defaults = parseCleanupArgs(['--org', 'aaa']);
    expect(defaults.ok).toBe(true);
    if (defaults.ok) expect(defaults.args.timeoutSeconds).toBe(60);
  });

  it('refuses verify combined with a write or with --delete-user', () => {
    expect(parseCleanupArgs(['--verify', '--apply', '--org', 'aaa'])).toEqual({
      ok: false,
      message: '--verify and --apply cannot be combined',
    });
    expect(
      parseCleanupArgs(['--verify', '--org', 'aaa', '--delete-user', 'x@y.z']),
    ).toEqual({ ok: false, message: '--verify does not take --delete-user' });
  });

  it('refuses a timeout that is not a positive integer', () => {
    for (const value of ['0', '-3', '1.5', 'abc', '90000']) {
      expect(
        parseCleanupArgs(['--org', 'aaa', '--timeout-seconds', value]),
      ).toEqual({
        ok: false,
        message: '--timeout-seconds needs an integer between 1 and 86400',
      });
    }
    expect(parseCleanupArgs(['--org', 'aaa', '--timeout-seconds'])).toEqual({
      ok: false,
      message: '--timeout-seconds needs a value',
    });
  });

  it('refuses a positional argument', () => {
    expect(parseCleanupArgs(['--org', 'aaa', 'orphan-id'])).toEqual({
      ok: false,
      message:
        'unknown argument "orphan-id"; usage: --org <id> [--org <id>]... [--delete-user <email>]... [--apply]',
    });
  });
});

// ─── Protected names ───────────────────────────────────────────────────────

describe('protected names', () => {
  it('always protects Motors Club regardless of case and padding', () => {
    expect(BUILT_IN_PROTECTED_ORG_NAMES).toContain('Motors Club');

    const protectedNames = protectedNameList(undefined);
    expect(findProtectedTargets(['  motors club '], protectedNames)).toEqual([
      'Motors Club',
    ]);
    expect(findProtectedTargets(['Prueba PRO'], protectedNames)).toEqual([]);
  });

  it('adds CLEANUP_PROTECT_ORGS names and keeps the built-in ones', () => {
    const protectedNames = protectedNameList('Motors Club, Tienda Real ,, ');

    expect(protectedNames).toEqual(['Motors Club', 'Tienda Real']);
    expect(findProtectedTargets(['tienda real'], protectedNames)).toEqual([
      'Tienda Real',
    ]);
  });

  it('removes repeats and ignores blank entries', () => {
    expect(protectedNameList('  ,Tienda Real,Tienda Real, ')).toEqual(
      expect.arrayContaining(['Motors Club', 'Tienda Real']),
    );
    expect(parseCommaList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(parseCommaList(undefined)).toEqual([]);
  });

  it('normalizes internal whitespace so a double space still matches', () => {
    expect(normalizeOrgName('  Motors   Club ')).toBe('motors club');
  });
});

// ─── Confirmation phrase ───────────────────────────────────────────────────

describe('confirmation phrase', () => {
  const names = ['Prueba PRO', 'Prueba BASIC'];

  it('is the exact comma-separated target names in order', () => {
    expect(expectedConfirmation(names)).toBe('Prueba PRO,Prueba BASIC');
  });

  it('matches only the exact phrase', () => {
    expect(confirmationMatches(names, 'Prueba PRO,Prueba BASIC')).toBe(true);
    expect(confirmationMatches(names, ' Prueba PRO,Prueba BASIC ')).toBe(true);
    expect(confirmationMatches(names, 'Prueba BASIC,Prueba PRO')).toBe(false);
    expect(confirmationMatches(names, 'Prueba PRO')).toBe(false);
    expect(confirmationMatches(names, 'Prueba PRO, Prueba BASIC')).toBe(false);
    expect(confirmationMatches(names, 'prueba pro,Prueba BASIC')).toBe(false);
    expect(confirmationMatches(names, undefined)).toBe(false);
  });
});

// ─── Environment gate ──────────────────────────────────────────────────────

describe('environmentGateRefusal', () => {
  it('allows development and test without an override', () => {
    expect(
      environmentGateRefusal({ nodeEnv: 'development', allowNonDev: false }),
    ).toBeNull();
    expect(
      environmentGateRefusal({ nodeEnv: 'test', allowNonDev: false }),
    ).toBeNull();
  });

  it('refuses production without CLEANUP_ALLOW_NON_DEV=true', () => {
    expect(
      environmentGateRefusal({ nodeEnv: 'production', allowNonDev: false }),
    ).toBe(
      'NODE_ENV is "production", so this cleanup needs CLEANUP_ALLOW_NON_DEV=true',
    );
    expect(
      environmentGateRefusal({ nodeEnv: undefined, allowNonDev: false }),
    ).toBe(
      'NODE_ENV is "undefined", so this cleanup needs CLEANUP_ALLOW_NON_DEV=true',
    );
  });

  it('allows a non-development environment when explicitly overridden', () => {
    expect(
      environmentGateRefusal({ nodeEnv: 'production', allowNonDev: true }),
    ).toBeNull();
  });
});

// ─── planCleanup ───────────────────────────────────────────────────────────

describe('planCleanup', () => {
  it('refuses an unknown organization id', () => {
    const snapshot = baseSnapshot({
      unknownOrgIds: ['missing-org'],
      targets: [orgSnapshot(TARGET_A, 'Prueba PRO')],
    });

    const plan = planCleanup(
      request({ orgIds: [TARGET_A, 'missing-org'] }),
      snapshot,
    );

    expect(plan.refusals).toContain(
      'organization id "missing-org" does not exist',
    );
    expect(plan.deleteUsers).toEqual([]);
  });

  it('refuses a protected target and plans no deletion', () => {
    const snapshot = baseSnapshot({
      targets: [
        orgSnapshot(TARGET_A, 'Prueba PRO'),
        orgSnapshot(PROTECTED_ID, 'Motors Club'),
      ],
      candidates: [
        userSnapshot({
          id: 'user-a',
          email: 'ana@example.test',
          memberships: [{ organizationId: TARGET_A }],
        }),
      ],
    });

    const plan = planCleanup(
      request({ orgIds: [TARGET_A, PROTECTED_ID] }),
      snapshot,
    );

    expect(plan.refusals).toContain(
      'organization "Motors Club" is protected and will never be deleted',
    );
    expect(plan.deleteUsers).toEqual([]);
  });

  it('refuses a target that holds fiscal documents, with the count', () => {
    const snapshot = baseSnapshot({
      targets: [
        orgSnapshot(TARGET_A, 'Prueba PRO', {}, { fiscalDocumentCount: 3 }),
      ],
    });

    const plan = planCleanup(request({ orgIds: [TARGET_A] }), snapshot);

    expect(plan.refusals).toContain(
      'target organization "Prueba PRO" holds 3 fiscal documents (legal records); refusing',
    );
  });

  it('refuses a name containing a comma because CLEANUP_CONFIRM gets ambiguous', () => {
    const snapshot = baseSnapshot({
      targets: [orgSnapshot(TARGET_A, 'Prueba, PRO')],
    });

    const plan = planCleanup(request({ orgIds: [TARGET_A] }), snapshot);

    expect(plan.refusals).toContain(
      'target organization names must not contain commas: "Prueba, PRO" makes CLEANUP_CONFIRM ambiguous',
    );
  });

  it('requires the exact confirmation phrase before writing', () => {
    const snapshot = baseSnapshot();

    const missing = planCleanup(request({ apply: true }), snapshot);
    const wrong = planCleanup(
      request({ apply: true, confirmation: 'Prueba BASIC,Prueba PRO' }),
      snapshot,
    );
    const accepted = planCleanup(
      request({ apply: true, confirmation: 'Prueba PRO,Prueba BASIC' }),
      snapshot,
    );

    expect(missing.refusals).toContain(
      'CLEANUP_CONFIRM is required with --apply: expected "Prueba PRO,Prueba BASIC"',
    );
    expect(wrong.refusals).toContain(
      'CLEANUP_CONFIRM does not match the target names: expected "Prueba PRO,Prueba BASIC", received "Prueba BASIC,Prueba PRO"',
    );
    expect(accepted.refusals).toEqual([]);
    expect(targetNames(accepted)).toEqual(['Prueba PRO', 'Prueba BASIC']);
  });

  it('computes orphaned users and keeps users with another membership', () => {
    const orphan = userSnapshot({
      id: 'user-orphan',
      email: 'ana@example.test',
      memberships: [{ organizationId: TARGET_A }, { organizationId: TARGET_B }],
    });
    const shared = userSnapshot({
      id: 'user-shared',
      email: 'kai@example.test',
      memberships: [
        { organizationId: TARGET_A },
        { organizationId: PROTECTED_ID },
      ],
    });
    const snapshot = baseSnapshot({
      candidates: [orphan, shared],
      organizations: [
        { id: PROTECTED_ID, name: 'Motors Club' },
        { id: TARGET_A, name: 'Prueba PRO' },
        { id: TARGET_B, name: 'Prueba BASIC' },
        { id: 'org-other', name: 'Cosméticos Aurora Sandbox' },
      ],
    });

    const plan = planCleanup(request(), snapshot);

    expect(plan.orphans.map((user) => user.email)).toEqual([
      'ana@example.test',
    ]);
    expect(plan.keptUsers).toHaveLength(1);
    expect(plan.keptUsers[0].user.email).toBe('kai@example.test');
    expect(plan.keptUsers[0].keptOrganizationNames).toEqual(['Motors Club']);
    expect(plan.deleteUsers.map((user) => user.email)).toEqual([
      'ana@example.test',
    ]);
  });

  it('never treats a user without memberships as an orphan', () => {
    const stray = userSnapshot({
      id: 'user-super',
      email: 'super@example.test',
      isSuperAdmin: true,
      memberships: [],
    });

    const notRequested = planCleanup(
      request(),
      baseSnapshot({ candidates: [stray] }),
    );
    const requested = planCleanup(
      request({ deleteUserEmails: ['super@example.test'] }),
      baseSnapshot({
        candidates: [stray],
        deleteUsers: [{ email: 'super@example.test', user: stray }],
        activeSuperAdminIds: ['user-super', 'another-super'],
      }),
    );

    expect(notRequested.orphans).toEqual([]);
    expect(notRequested.deleteUsers).toEqual([]);
    expect(requested.orphans).toEqual([]);
    expect(requested.requestedUsers.map((user) => user.email)).toEqual([
      'super@example.test',
    ]);
    expect(requested.deleteUsers.map((user) => user.email)).toEqual([
      'super@example.test',
    ]);
  });

  it('refuses --delete-user for an unknown email', () => {
    const plan = planCleanup(
      request({ deleteUserEmails: ['ghost@example.test'] }),
      baseSnapshot({
        deleteUsers: [{ email: 'ghost@example.test', user: null }],
      }),
    );

    expect(plan.refusals).toContain('user "ghost@example.test" does not exist');
  });

  it('refuses --delete-user while it still belongs to a non-target organization', () => {
    const shared = userSnapshot({
      id: 'user-shared',
      email: 'kai@example.test',
      memberships: [
        { organizationId: TARGET_A },
        { organizationId: PROTECTED_ID },
      ],
    });
    const plan = planCleanup(
      request({ deleteUserEmails: ['kai@example.test'] }),
      baseSnapshot({
        candidates: [shared],
        deleteUsers: [{ email: 'kai@example.test', user: shared }],
      }),
    );

    expect(plan.refusals).toContain(
      'user "kai@example.test" still belongs to organization "Motors Club", which is not a target; remove that membership first',
    );
  });

  it('refuses deleting the last active SuperAdmin', () => {
    const onlyAdmin = userSnapshot({
      id: 'user-super',
      email: 'super@example.test',
      isSuperAdmin: true,
      memberships: [{ organizationId: TARGET_A }],
    });
    const plan = planCleanup(
      request({ deleteUserEmails: ['super@example.test'] }),
      baseSnapshot({
        candidates: [onlyAdmin],
        deleteUsers: [{ email: 'super@example.test', user: onlyAdmin }],
        activeSuperAdminIds: ['user-super'],
      }),
    );

    expect(plan.refusals).toContain(
      'user "super@example.test" would be the last active SuperAdmin; refusing',
    );
  });

  it('allows deleting a SuperAdmin while another active one remains', () => {
    const admin = userSnapshot({
      id: 'user-super',
      email: 'super@example.test',
      isSuperAdmin: true,
      memberships: [{ organizationId: TARGET_A }],
    });
    const plan = planCleanup(
      request({ deleteUserEmails: ['super@example.test'] }),
      baseSnapshot({
        candidates: [],
        deleteUsers: [{ email: 'super@example.test', user: admin }],
        activeSuperAdminIds: ['user-super', 'user-kept-super'],
      }),
    );

    expect(plan.refusals).toEqual([]);
    expect(plan.deleteUsers.map((user) => user.email)).toEqual([
      'super@example.test',
    ]);
  });

  it('refuses deleting a user that still owns restrict-protected rows outside the targets', () => {
    const author = userSnapshot({
      id: 'user-author',
      email: 'author@example.test',
      memberships: [{ organizationId: TARGET_A }],
      blockingReferences: [
        { table: 'Task', count: 2 },
        { table: 'Expense', count: 1 },
      ],
    });

    const plan = planCleanup(request(), baseSnapshot({ candidates: [author] }));

    expect(plan.refusals).toContain(
      'user "author@example.test" still owns data outside the targets (Task: 2, Expense: 1); refusing',
    );
  });

  it('refuses an organization-scoped table that the plan does not handle', () => {
    const plan = planCleanup(
      request(),
      baseSnapshot({
        unplannedScopedTables: [{ table: 'NewTable', count: 4 }],
      }),
    );

    expect(plan.refusals).toContain(
      'table "NewTable" holds 4 rows for the targets but is not part of the cleanup plan; refusing',
    );
  });

  it('names the de-duplicated delete set: orphans plus requested users', () => {
    const both = userSnapshot({
      id: 'user-both',
      email: 'both@example.test',
      memberships: [{ organizationId: TARGET_A }],
    });

    const plan = planCleanup(
      request({ deleteUserEmails: ['both@example.test'] }),
      baseSnapshot({
        candidates: [both],
        deleteUsers: [{ email: 'both@example.test', user: both }],
      }),
    );

    expect(plan.refusals).toEqual([]);
    expect(plan.deleteUsers.map((user) => user.id)).toEqual(['user-both']);
  });
});

// ─── Trigger guard ─────────────────────────────────────────────────────────

describe('delete-trigger guard', () => {
  it('lists exactly the migration triggers that reject the row deletes', () => {
    expect(
      DELETE_BLOCKING_TRIGGERS.map(
        (guard) => `${guard.table}.${guard.trigger}`,
      ),
    ).toEqual([
      'InventoryLoanEvent.InventoryLoanEvent_append_only',
      'InventoryLoan.InventoryLoan_identity',
      'InventoryLoanItem.InventoryLoanItem_evidence',
      'InventoryLoanOperation.InventoryLoanOperation_immutable',
      'InventoryMovement.InventoryMovement_inventory_loan_immutable',
      'MoneyLoanEvent.MoneyLoanEvent_append_only',
      'PayrollAllocation.PayrollAllocation_history',
      'PayrollAllocationVoid.PayrollAllocationVoid_history',
      'PayrollCashOutflow.PayrollCashOutflow_identity',
      'PayrollCashReturn.PayrollCashReturn_history',
      'PayrollCashRevision.PayrollCashRevision_history',
      'PayrollInstallmentReference.PayrollInstallmentReference_history',
      'PayrollObligationExpense.PayrollObligationExpense_history',
      'PayrollShiftMembership.PayrollShiftMembership_history',
      'PosLoanSaleIntent.PosLoanSaleIntent_protect',
      'PosLoanSaleReservation.PosLoanSaleReservation_validate',
    ]);
  });

  it('only disables triggers on tables the plan deletes from', () => {
    const tables = new Set(ORG_CLEANUP_STEPS.map((step) => step.table));
    for (const guard of DELETE_BLOCKING_TRIGGERS) {
      expect(tables.has(guard.table)).toBe(true);
    }
    for (const guard of HARMLESS_DELETE_TRIGGERS) {
      expect(tables.has(guard.table)).toBe(true);
      expect(guard.reason.length).toBeGreaterThan(20);
    }
  });

  it('keeps only the site-balance delta trigger active, and explains why', () => {
    expect(
      HARMLESS_DELETE_TRIGGERS.map(
        (guard) => `${guard.table}.${guard.trigger}`,
      ),
    ).toEqual(['ProductStock.ProductStock_aggregate_delta']);
  });

  it('refuses a listed trigger that is missing from the database', () => {
    const guard = DELETE_BLOCKING_TRIGGERS[0];
    const plan = planCleanup(
      request(),
      baseSnapshot({
        triggers: healthyTriggerAudit({ missing: [guard] }),
      }),
    );

    expect(plan.refusals).toContain(
      `trigger "${guard.trigger}" on table "${guard.table}" is missing from this database; refusing`,
    );
    expect(plan.deleteUsers).toEqual([]);
  });

  it('refuses a listed trigger that is not enabled before the run', () => {
    const guard = DELETE_BLOCKING_TRIGGERS[0];
    const plan = planCleanup(
      request(),
      baseSnapshot({
        triggers: healthyTriggerAudit({ disabled: [guard] }),
      }),
    );

    expect(plan.refusals).toContain(
      `trigger "${guard.trigger}" on table "${guard.table}" is not enabled before the run; refusing`,
    );
  });

  it('refuses an unclassified DELETE trigger on a table it deletes from', () => {
    const plan = planCleanup(
      request(),
      baseSnapshot({
        triggers: healthyTriggerAudit({
          unexpected: [{ table: 'Sale', trigger: 'rogue_sale_delete' }],
        }),
      }),
    );

    expect(plan.refusals).toContain(
      'table "Sale" has an unclassified DELETE trigger "rogue_sale_delete"; refusing',
    );
  });

  it('refuses a role that does not own a table whose trigger it disables', () => {
    const guard = DELETE_BLOCKING_TRIGGERS[5];
    const plan = planCleanup(
      request(),
      baseSnapshot({
        triggers: healthyTriggerAudit({
          role: 'cleanup_outsider',
          unowned: [{ table: guard.table, role: 'cleanup_outsider' }],
        }),
      }),
    );

    expect(plan.refusals).toContain(
      `role "cleanup_outsider" does not own table "${guard.table}", so its triggers cannot be disabled; refusing`,
    );
  });

  it('names the trigger window as a function of the tables that have rows', () => {
    const plan = planCleanup(
      request(),
      baseSnapshot({
        targets: [
          orgSnapshot(TARGET_A, 'Prueba PRO', {
            MoneyLoan: 1,
            MoneyLoanEvent: 1,
          }),
        ],
      }),
    );
    const report = formatPlanReport(plan);

    expect(report).toContain(
      'Tables locked ACCESS EXCLUSIVE until COMMIT (history trigger disabled, 1 of 16): MoneyLoanEvent',
    );
    expect(report).toContain(
      "Tables deleted from (row locks on the targets' rows only): MoneyLoanEvent, MoneyLoan",
    );
  });

  it('does not lock InventoryMovement for a target without inventory loans', () => {
    const salesOnly = planCleanup(
      request(),
      baseSnapshot({
        targets: [
          orgSnapshot(TARGET_A, 'Prueba BASIC', {
            Sale: 3,
            InventoryMovement: 12,
          }),
        ],
      }),
    );
    expect(triggersToDisable(salesOnly)).toEqual([]);

    const withLoans = planCleanup(
      request(),
      baseSnapshot({
        targets: [
          orgSnapshot(TARGET_A, 'Prueba PRO', {
            InventoryMovement: 12,
            InventoryLoan: 1,
          }),
        ],
      }),
    );
    expect(triggersToDisable(withLoans).map((guard) => guard.trigger)).toEqual([
      'InventoryLoan_identity',
      'InventoryMovement_inventory_loan_immutable',
    ]);
  });

  it('names the connected role and database in the report', () => {
    const plan = planCleanup(request(), baseSnapshot());

    expect(formatPlanReport(plan)).toContain('role "cleanup_owner"');
  });
});

// ─── Report formatting ─────────────────────────────────────────────────────

describe('formatPlanReport', () => {
  const snapshot = baseSnapshot({
    targets: [
      orgSnapshot(
        TARGET_A,
        'Prueba PRO',
        { Product: 3, Sale: 2, WhatsAppConnection: 1 },
        {
          leftovers: {
            logoUrl: 'https://res.cloudinary.com/demo/logo-pro.png',
            productImages: [
              {
                productId: 'product-1',
                name: 'Camisa',
                imageUrl: 'https://res.cloudinary.com/demo/camisa.png',
              },
            ],
            whatsAppConnections: [
              {
                sessionName: 'demo-pro',
                channel: 'COMMERCIAL',
                status: 'WORKING',
              },
            ],
          },
        },
      ),
      orgSnapshot(TARGET_B, 'Prueba BASIC'),
    ],
    candidates: [
      userSnapshot({
        id: 'user-orphan',
        email: 'ana@example.test',
        name: 'Ana Pérez',
        memberships: [{ organizationId: TARGET_A }],
      }),
      userSnapshot({
        id: 'user-shared',
        email: 'kai@example.test',
        name: 'Kai Ruiz',
        memberships: [
          { organizationId: TARGET_A },
          { organizationId: PROTECTED_ID },
        ],
      }),
    ],
  });

  const plan = planCleanup(
    request({ deleteUserEmails: [], apply: false }),
    snapshot,
  );

  it('prints the target, its id, its non-zero row counts and the confirmation phrase', () => {
    const report = formatPlanReport(plan);

    expect(report).toContain('DRY RUN');
    expect(report).toContain('Prueba PRO');
    expect(report).toContain(`id ${TARGET_A}`);
    expect(report).toMatch(/products\s+3/);
    expect(report).toMatch(/sales\s+2/);
    expect(report).toMatch(/WhatsApp connections\s+1/);
    expect(report).toContain(
      'Confirmation phrase for --apply: Prueba PRO,Prueba BASIC',
    );
  });

  it('prints every orphan, every kept user with the organization it keeps, and the plain user identity', () => {
    const report = formatPlanReport(plan);

    expect(report).toContain(
      'Users that become orphaned and will be deleted (1):',
    );
    expect(report).toContain('Ana Pérez <ana@example.test>');
    expect(report).toContain('Users kept by another organization (1):');
    expect(report).toContain('Kai Ruiz <kai@example.test> keeps Motors Club');
  });

  it('prints the external leftovers it cannot delete', () => {
    const report = formatPlanReport(plan);

    expect(report).toContain(
      'organization logo URL: https://res.cloudinary.com/demo/logo-pro.png',
    );
    expect(report).toContain(
      'product image URL: https://res.cloudinary.com/demo/camisa.png ("Camisa")',
    );
    expect(report).toContain(
      'WhatsApp session "demo-pro" (COMMERCIAL, WORKING)',
    );
  });

  it('prints the locked tables, the digest and a shell-safe confirmation hint', () => {
    const quoted = planCleanup(
      request(),
      baseSnapshot({
        targets: [orgSnapshot(TARGET_A, "O'Brien Market", { Sale: 1 })],
      }),
    );
    const report = formatPlanReport(quoted);

    expect(report).toContain(
      "Tables deleted from (row locks on the targets' rows only): Sale",
    );
    expect(report).toContain(
      'Tables locked ACCESS EXCLUSIVE until COMMIT (history trigger disabled, 0 of 16): none',
    );
    expect(report).toContain('low-traffic window');
    expect(report).toContain(`CLEANUP_PLAN_DIGEST=${planDigest(quoted)}`);
    expect(report).toContain("CLEANUP_CONFIRM='O'\\''Brien Market'");
  });

  it('never prints a password hash or a password field', () => {
    const leaky = planCleanup(
      request(),
      baseSnapshot({
        candidates: [
          userSnapshot({
            id: 'user-1',
            email: 'ana@example.test',
            memberships: [{ organizationId: TARGET_A }],
          }),
        ],
      }),
    );
    const report = formatPlanReport(leaky);

    expect(report).not.toContain('password');
    expect(report).not.toMatch(/\$2[aby]\$/);
    expect(report).not.toContain('tokenVersion');
  });

  it('lists the refusals and says nothing was written when the plan is refused', () => {
    const refused = planCleanup(
      request(),
      baseSnapshot({ unknownOrgIds: ['x'] }),
    );

    const report = formatPlanReport(refused);

    expect(report).toContain('Refused (1):');
    expect(report).toContain('organization id "x" does not exist');
    expect(report).toContain('nothing was written');
  });
});

describe('recount formatting', () => {
  it('shows the same labels with the remaining counts', () => {
    const section = formatRecountSection('Recount after apply', [
      {
        orgId: TARGET_A,
        name: 'Prueba PRO',
        counts: [
          { table: 'Product', label: 'products', count: 0 },
          { table: 'Sale', label: 'sales', count: 0 },
        ],
        total: 0,
      },
    ]);

    expect(section).toContain('Recount after apply');
    expect(section).toContain('Prueba PRO');
    expect(section).toMatch(/rows left\s+0/);
  });

  it('compares the protected organizations before and after', () => {
    const before = [
      {
        id: 'org-motors-club',
        name: 'Motors Club',
        total: 12,
        counts: [
          { table: 'Product', label: 'products', count: 10 },
          { table: 'Sale', label: 'sales', count: 2 },
        ],
      },
    ];

    expect(formatProtectedComparison(before, before)).toContain(
      'Motors Club: 12 rows, unchanged',
    );
    expect(
      formatProtectedComparison(before, [
        {
          id: 'org-motors-club',
          name: 'Motors Club',
          total: 11,
          counts: [{ table: 'Product', label: 'products', count: 9 }],
        },
      ]),
    ).toContain('Motors Club: CHANGED (12 -> 11)');
  });
});

// ─── Plan digest (dry run ↔ apply binding) ─────────────────────────────────

describe('plan digest', () => {
  const snapshot = baseSnapshot({
    candidates: [
      userSnapshot({
        id: 'user-b',
        email: 'bravo@example.test',
        memberships: [{ organizationId: TARGET_A }],
      }),
      userSnapshot({
        id: 'user-a',
        email: 'alfa@example.test',
        memberships: [{ organizationId: TARGET_A }],
      }),
      userSnapshot({
        id: 'user-k',
        email: 'keeper@example.test',
        memberships: [
          { organizationId: TARGET_A },
          { organizationId: PROTECTED_ID },
        ],
      }),
    ],
    activeSuperAdminIds: ['user-super'],
  });

  const plan = planCleanup(request({ deleteUserEmails: ['user-a'] }), snapshot);

  it('is a stable sha256 over target ids, names and counts plus the user sets', () => {
    const digest = planDigest(plan);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(planDigest(plan)).toBe(digest);
    // Same facts, independently assembled, produce the same digest.
    expect(
      planDigestOf({
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
      }),
    ).toBe(digest);
  });

  it('changes when a row count changes', () => {
    const more = baseSnapshot({
      targets: [
        orgSnapshot(TARGET_A, 'Prueba PRO', { Product: 4, Sale: 2 }),
        orgSnapshot(TARGET_B, 'Prueba BASIC'),
      ],
      candidates: snapshot.candidates,
      activeSuperAdminIds: ['user-super'],
    });

    expect(
      planDigest(planCleanup(request({ deleteUserEmails: ['user-a'] }), more)),
    ).not.toBe(planDigest(plan));
  });

  it('changes when a target name changes', () => {
    const renamed = baseSnapshot({
      targets: [
        orgSnapshot(TARGET_A, 'Prueba PRO renombrada', { Product: 3, Sale: 2 }),
        orgSnapshot(TARGET_B, 'Prueba BASIC'),
      ],
      candidates: snapshot.candidates,
      activeSuperAdminIds: ['user-super'],
    });

    expect(
      planDigest(
        planCleanup(request({ deleteUserEmails: ['user-a'] }), renamed),
      ),
    ).not.toBe(planDigest(plan));
  });

  it('changes when the set of users to delete or keep changes', () => {
    // One more candidate that only belongs to a target becomes a new orphan.
    const extraOrphan = planCleanup(
      request({ deleteUserEmails: ['user-a'] }),
      baseSnapshot({
        candidates: [
          ...snapshot.candidates,
          userSnapshot({
            id: 'user-z',
            email: 'zeta@example.test',
            memberships: [{ organizationId: TARGET_B }],
          }),
        ],
        activeSuperAdminIds: ['user-super'],
      }),
    );
    // The kept user loses its outside membership, so it would now be deleted.
    const keptMoved = planCleanup(
      request({ deleteUserEmails: ['user-a'] }),
      baseSnapshot({
        candidates: snapshot.candidates.map((user) =>
          user.id === 'user-k'
            ? { ...user, memberships: [{ organizationId: TARGET_A }] }
            : user,
        ),
        activeSuperAdminIds: ['user-super'],
      }),
    );

    expect(planDigest(extraOrphan)).not.toBe(planDigest(plan));
    expect(planDigest(keptMoved)).not.toBe(planDigest(plan));
  });

  it('does not depend on the order the users are discovered in', () => {
    const reordered = baseSnapshot({
      candidates: [...snapshot.candidates].reverse(),
      activeSuperAdminIds: ['user-super'],
    });

    expect(
      planDigest(
        planCleanup(request({ deleteUserEmails: ['user-a'] }), reordered),
      ),
    ).toBe(planDigest(plan));
  });
});

// ─── Lock and trigger window ───────────────────────────────────────────────

describe('trigger window', () => {
  it('only disables triggers on tables the targets actually have rows in', () => {
    const plan = planCleanup(
      request(),
      baseSnapshot({
        targets: [
          orgSnapshot(TARGET_A, 'Prueba PRO', { Product: 3, Sale: 2 }),
          orgSnapshot(TARGET_B, 'Prueba BASIC'),
        ],
      }),
    );

    // Plan (delete) order: Sale is deleted before Product.
    expect(lockedTables(plan)).toEqual(['Sale', 'Product']);
    expect(triggersToDisable(plan)).toEqual([]);
  });

  it('disables the history triggers of the tables that do have rows', () => {
    const plan = planCleanup(
      request(),
      baseSnapshot({
        targets: [
          orgSnapshot(TARGET_A, 'Prueba PRO', {
            MoneyLoan: 1,
            MoneyLoanEvent: 2,
            InventoryMovement: 1,
            Sale: 1,
          }),
        ],
      }),
    );

    expect(
      triggersToDisable(plan)
        .map((guard) => guard.table)
        .sort(),
    ).toEqual(['MoneyLoanEvent']);
  });
});

// ─── Failure and verification reporting ────────────────────────────────────

describe('failure reporting', () => {
  it('separates a rollback from a committed run', () => {
    expect(formatRollbackFailure('relation "Sale" is locked')).toBe(
      'failed, transaction rolled back: relation "Sale" is locked',
    );

    const committed = formatPostCommitFailure({
      organizations: 4,
      users: 6,
      failures: ['Cosméticos Aurora still holds 3 rows'],
    });
    expect(committed).toContain(
      'COMMITTED: 4 organizations and 6 users were deleted; post-commit verification failed',
    );
    expect(committed).toContain('Cosméticos Aurora still holds 3 rows');
    expect(committed).toContain('SELECT c.relname, t.tgname, t.tgenabled');
    expect(committed).toContain(
      'ALTER TABLE "<table>" ENABLE TRIGGER "<trigger>"',
    );
  });

  it('exits 2 only when the post-commit verification reports failures', () => {
    expect(postCommitExitCode({ failures: [] })).toBe(0);
    expect(postCommitExitCode({ failures: ['x'] })).toBe(2);
  });

  it('quotes the confirmation hint so a single quote survives a shell', () => {
    expect(shellQuote("O'Brien Market")).toBe("'O'\\''Brien Market'");
  });

  it('reports the verify mode and decides whether it passed', () => {
    const gone = {
      organizations: [{ id: 'org-a', name: null }],
      triggers: { checked: 16, offenders: [] },
    };
    const stillThere = {
      organizations: [{ id: 'org-b', name: 'Prueba BASIC' }],
      triggers: { checked: 16, offenders: [] },
    };
    const triggerOff = {
      organizations: [{ id: 'org-a', name: null }],
      triggers: {
        checked: 16,
        offenders: [
          { table: 'MoneyLoanEvent', trigger: 'MoneyLoanEvent_append_only' },
        ],
      },
    };

    expect(verifySucceeded(gone)).toBe(true);
    expect(verifySucceeded(stillThere)).toBe(false);
    expect(verifySucceeded(triggerOff)).toBe(false);
    expect(formatVerifyReport(gone)).toContain('org-a: gone');
    expect(formatVerifyReport(stillThere)).toContain(
      'org-b: still exists "Prueba BASIC"',
    );
    expect(formatVerifyReport(triggerOff)).toContain(
      'MoneyLoanEvent.MoneyLoanEvent_append_only: DISABLED',
    );
    expect(formatVerifyReport(gone)).toContain(
      'History triggers enabled: 16 checked',
    );
  });
});

// ─── Table plan ────────────────────────────────────────────────────────────

describe('ORG_CLEANUP_STEPS', () => {
  it('is the exact children-first production order', () => {
    expect(ORG_CLEANUP_STEPS.map((step) => step.table)).toEqual([
      'PayrollAllocationVoid',
      'PayrollCashReturn',
      'PayrollCashRevision',
      'PayrollAllocation',
      'PayrollInstallmentReference',
      'PayrollShiftMembership',
      'PayrollInstallment',
      'PayrollObligationExpense',
      'PayrollCashOutflow',
      'PayrollObligation',
      'EmployeeShift',
      'Employee',
      'PayrollExpenseCategory',
      'ExpensePayment',
      'Expense',
      'ExpenseLabel',
      'ExpenseGroup',
      'InventoryMovement',
      'InventoryLoanEvent',
      'InventoryLoanOperation',
      'InventoryLoanItem',
      'InventoryLoan',
      'PosLoanSaleReservation',
      'PosLoanSaleIntentOriginSite',
      'PosLoanSaleIntent',
      'SaleOriginSite',
      'SaleItem',
      'Payment',
      'Sale',
      'MoneyLoanEvent',
      'MoneyLoan',
      'PurchaseOrderItem',
      'PurchaseOrder',
      'StockTransferItem',
      'StockTransfer',
      'ProductStock',
      'ProductStockAlertEvent',
      'ProductStockAlert',
      'Product',
      'Category',
      'CustomerVehicle',
      'Customer',
      'Supplier',
      'MembershipLocation',
      'OrganizationUser',
      'RefreshToken',
      'OrganizationSequence',
      'CashRegister',
      'TaskEvent',
      'Task',
      'AuditLog',
      'PaymentRecord',
      'WhatsAppDelivery',
      'WhatsAppMessage',
      'WhatsAppConversation',
      'WhatsAppProcessedEvent',
      'WhatsAppInternalContact',
      'WhatsAppIdentity',
      'WhatsAppLinkChallenge',
      'WhatsAppConnection',
      'OrganizationModule',
      'Location',
    ]);
  });

  it('keeps FiscalDocument out: fiscal documents are refused, never deleted', () => {
    expect(ORG_CLEANUP_STEPS.map((step) => step.table)).not.toContain(
      'FiscalDocument',
    );
  });

  it('has unique tables and human labels', () => {
    const tables = ORG_CLEANUP_STEPS.map((step) => step.table);
    const labels = ORG_CLEANUP_STEPS.map((step) => step.label);

    expect(new Set(tables).size).toBe(tables.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  });

  it('deletes every child before the row it restricts', () => {
    const position = new Map(
      ORG_CLEANUP_STEPS.map((step, index) => [step.table, index]),
    );
    const before = (child: string, parent: string) => {
      const childIndex = position.get(child);
      const parentIndex = position.get(parent);
      if (childIndex === undefined || parentIndex === undefined) {
        throw new Error(`missing step: ${child} or ${parent}`);
      }
      expect({ child, parent, ordered: childIndex < parentIndex }).toEqual({
        child,
        parent,
        ordered: true,
      });
    };

    before('PayrollAllocationVoid', 'PayrollAllocation');
    before('PayrollCashReturn', 'PayrollInstallment');
    before('PayrollInstallment', 'PayrollObligation');
    before('PayrollObligationExpense', 'PayrollObligation');
    before('PayrollObligationExpense', 'Expense');
    before('PayrollCashOutflow', 'Employee');
    before('EmployeeShift', 'Employee');
    before('InventoryMovement', 'InventoryLoanEvent');
    before('InventoryLoanEvent', 'InventoryLoanItem');
    before('InventoryLoanEvent', 'InventoryLoanOperation');
    before('InventoryLoanItem', 'InventoryLoan');
    before('PosLoanSaleReservation', 'PosLoanSaleIntent');
    before('PosLoanSaleIntent', 'Sale');
    before('PosLoanSaleIntent', 'MoneyLoan');
    before('SaleItem', 'Sale');
    before('Payment', 'Sale');
    before('SaleOriginSite', 'Sale');
    before('MoneyLoanEvent', 'MoneyLoan');
    before('PurchaseOrderItem', 'PurchaseOrder');
    before('StockTransferItem', 'StockTransfer');
    before('StockTransfer', 'Location');
    before('ProductStock', 'Product');
    before('ProductStock', 'Location');
    before('Product', 'Category');
    before('CustomerVehicle', 'Customer');
    before('InventoryLoan', 'Customer');
    before('TaskEvent', 'Task');
    before('MembershipLocation', 'OrganizationUser');
    before('WhatsAppMessage', 'WhatsAppConversation');
    before('WhatsAppConversation', 'WhatsAppConnection');
    before('WhatsAppDelivery', 'WhatsAppConnection');
    before('OrganizationUser', 'Location');
  });
});
