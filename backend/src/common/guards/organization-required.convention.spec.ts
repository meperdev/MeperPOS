import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * SEC-002 hardening: a repo-wide structural invariant. Every controller in
 * `src/**` that is NOT in the audited allowlist MUST carry
 * `OrganizationRequiredGuard` in its guards, because `user.organizationId`
 * arriving undefined makes the service-layer fallback
 * `...(organizationId ? { organizationId } : {})` query ALL organizations.
 *
 * The allowlist is exactly the audited set (FASE 2): platform SUPER_ADMIN
 * routes, pre-auth routes and the HMAC-authenticated webhook. A controller
 * leaves the allowlist only by adding the guard — never by editing this
 * list without a security review (docs/security/FINDINGS.md, SEC-002).
 */
const ALLOWED_WITHOUT_GUARD = new Set([
  // Public health/root
  'app.controller.ts',
  // Pre-auth entry points (login, refresh, select-organization...)
  'auth/auth.controller.ts',
  // Platform SUPER_ADMIN panel
  'admin/admin.controller.ts',
  'business-modules/admin-business-modules.controller.ts',
  // Module catalog read (platform-level)
  'business-modules/admin-module-catalog.controller.ts',
  // Plan-limit status is resolved from the caller's org when present
  'plan-limits/plan-limits.controller.ts',
  // Webhook authenticated by WAHA HMAC, not by session
  'whatsapp/whatsapp-webhook.controller.ts',
]);

function listControllers(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listControllers(full, `${prefix}${entry}/`));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(`${prefix}${entry}`);
    }
  }
  return out;
}

describe('Tenant boundary convention (SEC-002 structural guard)', () => {
  // __dirname = src/common/guards -> up two levels = src/
  const srcRoot = join(__dirname, '..', '..');

  it('every non-allowlisted controller registers OrganizationRequiredGuard', () => {
    const controllers = listControllers(srcRoot);
    expect(controllers.length).toBeGreaterThan(20); // sanity: scan found them

    const missing: string[] = [];
    for (const relPath of controllers) {
      if (ALLOWED_WITHOUT_GUARD.has(relPath)) {
        continue;
      }
      const content = readFileSync(join(srcRoot, relPath), 'utf-8');
      if (!content.includes('OrganizationRequiredGuard')) {
        missing.push(relPath);
      }
    }

    expect(missing).toEqual([]);
  });

  it('the allowlist only contains controllers that actually exist', () => {
    const controllers = new Set(listControllers(srcRoot));
    const stale = [...ALLOWED_WITHOUT_GUARD].filter((c) => !controllers.has(c));

    // A renamed/deleted allowlisted file must be removed from the list, so
    // the list cannot silently grow to cover files it never audited.
    expect(stale).toEqual([]);
  });
});
