/**
 * meperpos/require-organization-guard
 *
 * What it forbids
 *   A `@UseGuards(...)` decorator that authenticates the route with
 *   `JwtAuthGuard` but does not also register `OrganizationRequiredGuard`,
 *   either in the same decorator or in the enclosing class's `@UseGuards`.
 *
 * Why
 *   `OrganizationRequiredGuard` is the tenant boundary (security audit SEC-002,
 *   docs/security/FINDINGS.md). Without it `user.organizationId` can arrive
 *   `undefined`, and the service-layer fallback
 *   `...(organizationId ? { organizationId } : {})` silently turns into a
 *   cross-tenant, all-organizations query. See the "Key Conventions" section
 *   of AGENTS.md and src/common/guards/organization-required.guard.ts.
 *
 * How to fix
 *   Add the guard next to the authentication guard:
 *
 *     @UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
 *
 *   Only platform SUPER_ADMIN routes and pre-auth/user-scoped routes may omit
 *   it, and then with an explicit reason on the decorator line:
 *
 *     // eslint-disable-next-line meperpos/require-organization-guard -- SUPER_ADMIN platform route, no tenant scope
 *     @UseGuards(JwtAuthGuard, RolesGuard)
 */

const AUTH_GUARD = 'JwtAuthGuard';
const TENANT_GUARD = 'OrganizationRequiredGuard';

/** Returns the guard identifiers of a `@UseGuards(...)` decorator, or null. */
function useGuardsNames(decorator) {
  const call = decorator.expression;
  if (
    call?.type !== 'CallExpression' ||
    call.callee.type !== 'Identifier' ||
    call.callee.name !== 'UseGuards'
  ) {
    return null;
  }
  return call.arguments
    .map((arg) => {
      if (arg.type === 'Identifier') return arg.name;
      // `new SomeGuard()` instances are accepted by Nest as well.
      if (arg.type === 'NewExpression' && arg.callee.type === 'Identifier') {
        return arg.callee.name;
      }
      return null;
    })
    .filter(Boolean);
}

/** True when any `@UseGuards` on the given node lists the tenant guard. */
function hasTenantGuard(node) {
  return (node?.decorators ?? []).some((decorator) =>
    (useGuardsNames(decorator) ?? []).includes(TENANT_GUARD),
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require OrganizationRequiredGuard wherever JwtAuthGuard protects a route (tenant boundary, SEC-002).',
    },
    schema: [],
    messages: {
      missingTenantGuard:
        '`@UseGuards` uses JwtAuthGuard without OrganizationRequiredGuard, so a missing organizationId can turn into a cross-tenant query (SEC-002). Add OrganizationRequiredGuard, or disable this line with a `-- reason` if the route is a SUPER_ADMIN platform or pre-auth/user-scoped route.',
    },
  },
  create(context) {
    return {
      Decorator(decorator) {
        const names = useGuardsNames(decorator);
        if (!names || !names.includes(AUTH_GUARD)) return;
        if (names.includes(TENANT_GUARD)) return;

        // Nest merges class-level and method-level guards, so a method is
        // covered when its class already registers the tenant guard.
        const owner = decorator.parent;
        const isMember =
          owner.type === 'MethodDefinition' ||
          owner.type === 'PropertyDefinition';
        if (isMember && hasTenantGuard(owner.parent?.parent)) return;

        context.report({ node: decorator, messageId: 'missingTenantGuard' });
      },
    };
  },
};

export default rule;
