import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY, type RoleType } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

/**
 * The permission matrix: every HTTP route of every controller and the
 * organization roles that get past `RolesGuard` on it, asked of the real guard
 * (a route without the guard lets every role through). The snapshot is the
 * reviewed state of who can do what; changing a permission means updating it
 * (`npx jest src/common/guards/permission-matrix.spec.ts -u`) and the diff is
 * the change a reviewer reads.
 *
 * Columns: A ADMIN, C CASHIER, I INVENTORY_USER — the three roles of S1.
 * SUPER_ADMIN passes every route `RolesGuard` checks, so it has no column. Flags:
 *   open        no @Roles: every authenticated role passes RolesGuard
 *   no-guard    no RolesGuard on the route: @Roles there is not enforced
 */
const ORG_ROLES: readonly [string, OrgRole][] = [
  ['A', OrgRole.ADMIN],
  ['C', OrgRole.CASHIER],
  ['I', OrgRole.INVENTORY_USER],
];

const guard = new RolesGuard(new Reflector());

/** Asks the real RolesGuard, the same way Nest does for this handler. */
function guardAllows(
  controller: new (...args: never[]) => unknown,
  handler: (...args: unknown[]) => unknown,
  role: OrgRole,
): boolean {
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
  try {
    const allowed: unknown = guard.canActivate(context);
    if (typeof allowed !== 'boolean') {
      throw new Error('RolesGuard.canActivate stopped returning a boolean');
    }
    return allowed;
  } catch (error) {
    // Only the guard's own denial means "denied"; anything else is a broken
    // fixture or guard and must fail the test, not turn the cell into "-".
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

function listControllers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listControllers(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out.sort();
}

const asList = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : [value ?? ''];

function joinPath(...parts: string[]): string {
  const path = parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');
  return `/api/${path}`.replace(/\/$/, '');
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

function buildMatrix(srcRoot: string): string[] {
  const rows: string[] = [];
  for (const file of listControllers(srcRoot)) {
    const exports = jest.requireActual<Record<string, unknown>>(file);
    for (const candidate of Object.values(exports)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as new (...args: never[]) => unknown;
      const basePath = Reflect.getMetadata(PATH_METADATA, controller) as
        | string
        | string[]
        | undefined;
      if (basePath === undefined) continue;

      const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as
        | RoleType[]
        | undefined;
      const classGuarded = guardsOf(controller).includes(RolesGuard);
      const proto = controller.prototype as Record<string, unknown>;

      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          | RequestMethod
          | undefined;
        if (method === undefined) continue;

        const roles =
          (Reflect.getMetadata(ROLES_KEY, handler) as RoleType[] | undefined) ??
          classRoles;
        const guarded = classGuarded || guardsOf(handler).includes(RolesGuard);
        const open = !roles || roles.length === 0;
        const cells = ORG_ROLES.map(([letter, role]) =>
          !guarded ||
          guardAllows(
            controller,
            handler as (...args: unknown[]) => unknown,
            role,
          )
            ? letter
            : '-',
        ).join('');
        const flags = [open ? 'open' : '', guarded ? '' : 'no-guard']
          .filter(Boolean)
          .join(' ');
        const verb = RequestMethod[method].padEnd(6);

        for (const base of asList(basePath)) {
          const subPath = Reflect.getMetadata(PATH_METADATA, handler) as
            | string
            | string[]
            | undefined;
          for (const sub of asList(subPath)) {
            rows.push(
              `${verb} ${joinPath(base, sub).padEnd(58)} ${cells}${flags ? `  ${flags}` : ''}  [${relative(srcRoot, file)}]`,
            );
          }
        }
      }
    }
  }
  return rows.sort();
}

describe('permission matrix (who passes RolesGuard on each route)', () => {
  const srcRoot = join(__dirname, '..', '..');
  const matrix = buildMatrix(srcRoot);

  it('finds every controller route', () => {
    // 220 routes when this was pinned; the snapshot lists each one, and a
    // controller that stops loading drops far more than a handful.
    expect(matrix.length).toBeGreaterThanOrEqual(215);
  });

  it('asks the guard for real: known routes keep their known answer', () => {
    const cellsOf = (verb: string, path: string) =>
      matrix
        .find((row) => row.startsWith(`${verb.padEnd(6)} ${path.padEnd(58)} `))
        ?.slice(66, 69);

    expect(cellsOf('GET', '/api/sales')).toBe('AC-');
    expect(cellsOf('POST', '/api/products')).toBe('A--');
    expect(cellsOf('GET', '/api/admin/metrics')).toBe('---');
    expect(cellsOf('GET', '/api/products')).toBe('ACI');
  });

  it('matches the reviewed matrix', () => {
    expect(matrix.join('\n')).toMatchSnapshot();
  });
});
