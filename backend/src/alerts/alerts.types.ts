import type { OrgRole } from '@prisma/client';

/** The closed set of alert categories the feed may return. */
export type AlertCategory = 'billing' | 'limits' | 'stock' | 'loans' | 'tasks';

/** Severity only decides colour and ordering; it never hides an alert. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/**
 * One alert as the client renders it.
 *
 * `revision` is the fingerprint of the facts behind the alert. The client keeps
 * `id -> revision` per organization and treats a different revision as unread,
 * so a new low-stock product re-alerts without inventing a new alert id, and a
 * resolved condition cannot leave a stale badge behind.
 */
export interface OrgAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
  revision: string;
}

/** Which categories a role may see. Decided on the server, never by the client. */
export interface AlertVisibility {
  billing: boolean;
  stock: boolean;
  operations: boolean;
}

/** The organization facts billing alerts need, already narrowed to two fields. */
export interface AlertOrganization {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  trialEndsAt: Date | null;
}

/**
 * Everything the pure builder needs. The service gathers these signals; the
 * builder owns the copy, the ordering and the revisions, so the whole feed can
 * be asserted without a database or a clock.
 */
export interface AlertSignals {
  role: OrgRole | 'SUPER_ADMIN';
  now: Date;
  organization: AlertOrganization | null;
  limits: Array<{
    type: 'users' | 'products' | 'customers' | 'cashRegisters';
    current: number;
    limit: number;
    exceeded: boolean;
    warningAt: number;
  }>;
  lowStock: Array<{ id: string; stock: number; minStock: number }>;
  overdueLoans: Array<{ id: string; dueAt: Date }>;
  overdueTasks: Array<{ id: string }>;
}
