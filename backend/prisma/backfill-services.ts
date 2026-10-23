import { OrgRole, PrismaClient, ProductType } from '@prisma/client';
import {
  planServicesBackfill,
  buildServiceConversionStockGuard,
  type BackfillAction,
  type BackfillPlan,
  type ServiceTarget,
} from '../src/backfill/services-backfill.plan';

/**
 * Services backfill CLI (work unit 7), wired as `backfill:services`.
 *
 * It corrects the six owner-confirmed services that were created as PRODUCT
 * and are overstating stock in the reports, so they are marked SERVICE and
 * their stock goes to 0 with a matching ADJUSTMENT_OUT movement.
 *
 * Safety contract:
 *  - DRY-RUN IS THE DEFAULT. Only the exact `--apply` flag writes anything, so
 *    a naked `npm run backfill:services` cannot touch a single row.
 *  - The scope is ONE organization (slug FMC-001 by default, `--org` to
 *    override), because the production database also holds `test-001`.
 *  - Production needs the explicit BACKFILL_ALLOW_PRODUCTION=true gate.
 *  - It fails closed: if any target is missing or ambiguous, it refuses the
 *    whole plan and writes nothing.
 *  - Every write happens inside ONE transaction.
 *
 * The decision logic lives in ../src/backfill/services-backfill.plan.ts, so
 * this file only reads arguments/environment, runs one plan and reports it.
 */

const prisma = new PrismaClient();

const LOG_PREFIX = '[backfill:services]';

const MOVEMENT_REASON = 'Corrección: servicio, no mercancía';

const DEFAULT_ORG_SLUG = 'FMC-001';

// Owner-confirmed target list. Do not extend it by inference: the rows are
// matched on name AND sku, and anything not listed here is left alone.
const TARGETS: ServiceTarget[] = [
  { name: 'MANO DE OBRA', sku: 'SERV' },
  { name: 'SCANNER', sku: 'SERVICIO' },
  { name: 'Sincronizacion General', sku: 'MEC-001' },
  { name: 'MANTENIMIENTO', sku: 'SERV 4' },
  { name: 'SERVICIO', sku: '123' },
  { name: 'RETIRO CALCAS', sku: 'SERV 11' },
];

interface CliOptions {
  apply: boolean;
  orgSlug: string;
}

interface WriteSummary {
  rowsWritten: number;
  movementsWritten: number;
}

/**
 * Reads the command line. `--apply` is the ONLY thing that enables writes, so
 * with no flag the run is a dry run and never writes a row.
 *
 * Anything not unambiguously understood fails closed: an unrecognised
 * argument, a malformed `--org` (the organization scope must never be
 * guessed), and `--apply` together with `--dry-run` (contradictory intent, so
 * the run is refused rather than resolved by argument order).
 *
 * An unrecognised argument aborts on purpose. The dangerous case is a mistyped
 * scope: tolerating it would let a run carrying `--apply` fall back to the
 * default organization and write to the wrong one.
 */
function parseArgs(argv: string[]): CliOptions {
  let wantsApply = false;
  let wantsDryRun = false;
  let orgSlug = DEFAULT_ORG_SLUG;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      wantsApply = true;
      continue;
    }

    if (arg === '--dry-run') {
      wantsDryRun = true;
      continue;
    }

    if (arg === '--org') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(
          '--org requires a slug value, for example --org FMC-001',
        );
      }
      orgSlug = value.trim();
      index += 1;
      if (!orgSlug) {
        throw new Error('--org received an empty slug, for example --org FMC-001');
      }
      continue;
    }

    if (arg.startsWith('--org=')) {
      orgSlug = arg.slice('--org='.length).trim();
      if (!orgSlug) {
        throw new Error('--org received an empty slug, for example --org FMC-001');
      }
      continue;
    }

    // Fail closed. A flag this script does not understand means the operator's
    // intent was not honoured, and the dangerous case is a mistyped scope:
    // falling back to the default organization while --apply is present would
    // write to the wrong one.
    throw new Error(
      `argumento no reconocido "${arg}" (soportados: --apply, --dry-run, --org <slug>). Aborting: no se escribió nada.`,
    );
  }

  if (wantsApply && wantsDryRun) {
    throw new Error(
      '--apply and --dry-run cannot be combined. Elegí uno: aborting.',
    );
  }

  return { apply: wantsApply && !wantsDryRun, orgSlug };
}

function movementLabel(action: BackfillAction): string {
  if (!action.requiresMovement) {
    return 'none';
  }

  return `ADJUSTMENT_OUT ${action.movementQuantity} (${action.previousStock} → 0)`;
}

function printDryRun(plan: BackfillPlan, orgLabel: string): void {
  console.log(`\n${LOG_PREFIX} DRY-RUN against ${orgLabel}`);
  console.log(
    '  (nothing is written; pass --apply to write, and production also needs BACKFILL_ALLOW_PRODUCTION=true)',
  );
  console.log('\n  Acciones planificadas:');
  console.log('  ┌────────────────────────┬──────────────────────┬──────────┬──────────────┬────────────┬───────────────────────────────────┐');
  console.log('  │ product id             │ nombre               │ sku      │ stock previo │ ya servicio│ movimiento que se escribiría       │');
  console.log('  ├────────────────────────┼──────────────────────┼──────────┼──────────────┼────────────┼───────────────────────────────────┤');

  for (const action of plan.actions) {
    const id = action.productId.padEnd(22);
    const name = action.name.slice(0, 20).padEnd(20);
    const sku = action.sku.slice(0, 8).padEnd(8);
    const stock = String(action.previousStock).padStart(12);
    const already = (action.alreadyService ? 'sí' : 'no').padEnd(10);
    const movement = movementLabel(action).padEnd(33);
    console.log(`  │ ${id} │ ${name} │ ${sku} │ ${stock} │ ${already} │ ${movement} │`);
  }

  console.log('  └────────────────────────┴──────────────────────┴──────────┴──────────────┴────────────┴───────────────────────────────────┘');

  printTotals(plan);
}

function printTotals(plan: BackfillPlan): void {
  const toWrite = plan.actions.filter((action) => action.requiresWrite);
  const withMovement = toWrite.filter((action) => action.requiresMovement);
  const unitsRemoved = withMovement.reduce(
    (total, action) => total + action.previousStock,
    0,
  );

  console.log('\n  Totales:');
  console.log(`    - filas a escribir (productos): ${toWrite.length}`);
  console.log(`    - movimientos a escribir:       ${withMovement.length}`);
  console.log(`    - unidades que se retiran:      ${unitsRemoved}`);

  if (toWrite.length === 0) {
    console.log('    (nada pendiente: una corrida anterior ya dejó todo corregido)');
  }
}

function printRefusals(plan: BackfillPlan): void {
  console.error(`\n❌ ${LOG_PREFIX} refused: la lista confirmada no se pudo resolver completa.`);
  console.error('   Ningún objetivo quedó sin revisar, así que no se escribe nada (fail closed):');

  for (const refusal of plan.refusals) {
    const detail =
      refusal.reason === 'NOT_FOUND'
        ? 'sin coincidencias: revisá nombre y sku exactos'
        : `${refusal.matches} coincidencias: hay que desambiguar a mano`;
    console.error(
      `   - "${refusal.target.name}" / "${refusal.target.sku}" → ${refusal.reason} (${detail})`,
    );
  }

  console.error('   Un backfill parcial es peor que ninguno. Aborting.\n');
}

async function resolveActorUserId(organizationId: string): Promise<string | null> {
  const primaryOwner = await prisma.organizationUser.findFirst({
    where: { organizationId, isPrimaryOwner: true },
    select: { userId: true },
  });

  if (primaryOwner) {
    return primaryOwner.userId;
  }

  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: OrgRole.ADMIN },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });

  return admin ? admin.userId : null;
}

async function applyPlan(
  plan: BackfillPlan,
  organizationId: string,
  actorUserId: string,
): Promise<WriteSummary> {
  // One transaction for every write: a partial correction would leave stock
  // and type out of sync.
  return prisma.$transaction(async (tx) => {
    let rowsWritten = 0;
    let movementsWritten = 0;

    for (const action of plan.actions) {
      if (!action.requiresWrite) {
        // Already corrected: no write at all. This is what makes the run
        // idempotent.
        continue;
      }

      // Pin live stock, version and the zero reservation counter. A changed
      // snapshot aborts the entire conversion, never repairing reservations.
      const live = await tx.product.findFirst({
        where: { id: action.productId, organizationId },
        select: { stock: true, version: true, reservedStock: true },
      });

      if (!live) {
        throw new Error(
          `Producto ${action.productId} desapareció entre la planificación y la aplicación; no se escribió nada.`,
        );
      }

      const { count } = await tx.product.updateMany({
        where: buildServiceConversionStockGuard(
          action.productId,
          organizationId,
          live,
        ),
        data: {
          type: ProductType.SERVICE,
          stock: 0,
          version: { increment: 1 },
        },
      });

      if (count === 0) {
        throw new Error(
          `Producto ${action.productId} cambió entre la planificación y la aplicación; el backfill se niega a pisarlo y no escribió nada.`,
        );
      }

      rowsWritten += 1;

      if (live.stock !== 0) {
        await tx.inventoryMovement.create({
          data: {
            productId: action.productId,
            type: 'ADJUSTMENT_OUT',
            quantity: -live.stock,
            previousStock: live.stock,
            newStock: 0,
            reason: MOVEMENT_REASON,
            userId: actorUserId,
            organizationId,
          },
        });
        movementsWritten += 1;
      }
    }

    return { rowsWritten, movementsWritten };
  });
}

async function run(): Promise<number> {
  const { apply, orgSlug } = parseArgs(process.argv.slice(2));

  // Guard: this script mutates real stock. In dev/test it runs freely;
  // production requires an explicit opt-in, mirroring seed-org.ts.
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = nodeEnv === 'production';
  const allowProduction = process.env.BACKFILL_ALLOW_PRODUCTION === 'true';

  if (isProduction && !allowProduction) {
    console.error(
      `❌ Refusing to backfill services: NODE_ENV is "${nodeEnv}". ` +
      'This script overwrites product type and stock, so to run against ' +
      'production set BACKFILL_ALLOW_PRODUCTION=true explicitly. Aborting.',
    );
    return 1;
  }

  if (isProduction) {
    console.warn(
      '⚠️  BACKFILL_ALLOW_PRODUCTION=true — you are deliberately writing ' +
      `against production, scoped to organization "${orgSlug}" only.\n`,
    );
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, slug: true },
  });

  if (!org) {
    console.error(
      `❌ No se encontró la organización con slug "${orgSlug}". Verificá el valor de --org. Aborting.`,
    );
    return 1;
  }

  const orgLabel = `${org.name} (slug: ${org.slug})`;

  const actorUserId = await resolveActorUserId(org.id);
  if (!actorUserId) {
    console.error(
      `❌ La organización "${orgLabel}" no tiene dueño primario ni usuario ADMIN que puedas ` +
      'usar como responsable de los movimientos de kárdex. Asigná uno primero. Aborting.',
    );
    return 1;
  }

  const rows = await prisma.product.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      type: true,
      active: true,
    },
  });

  console.log(
    `${LOG_PREFIX} organización ${orgLabel}: ${rows.length} productos cargados, ${TARGETS.length} objetivos confirmados.`,
  );

  const plan = planServicesBackfill(TARGETS, rows);

  if (!plan.canApply) {
    printRefusals(plan);
    return 1;
  }

  if (!apply) {
    printDryRun(plan, orgLabel);
    console.log(`\n✅ ${LOG_PREFIX} dry run completed. No se escribió ninguna fila.\n`);
    return 0;
  }

  console.log(`\n${LOG_PREFIX} APPLY against ${orgLabel} (una sola transacción)...`);

  const summary = await applyPlan(plan, org.id, actorUserId);

  console.log(`\n✅ ${LOG_PREFIX} backfill completed.`);
  console.log(`   - productos actualizados a SERVICE con stock 0: ${summary.rowsWritten}`);
  console.log(`   - movimientos ADJUSTMENT_OUT creados:           ${summary.movementsWritten}`);
  console.log(`   - responsable del kárdex (userId):              ${actorUserId}`);
  console.log('   - Idempotente: podés volver a ejecutarlo sin duplicar nada.');
  console.log('   - No se tocaron otras organizaciones.');
  return 0;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${LOG_PREFIX} failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
