"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api";
import { SectionShell } from "./SectionShell";

/**
 * The slice of a query result a report block needs. Structural on purpose: the
 * blocks render from a React Query result on the page and from a plain object
 * in tests without dragging the observer type along.
 */
export type ReportQuery<T> = {
  data?: T;
  isLoading: boolean;
  error: unknown;
  refetch: () => unknown;
};

/** One quiet line standing in for a block whose content would be nearly empty. */
export function BlockNote({ children }: { children: ReactNode }) {
  return <p className="py-1 text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * The scope a block keeps when the page is read for one site: the figure is the
 * organization's, because what it adds up (expenses, cash, the catalog) carries
 * no site. Saying it is the difference between a view and a wrong number.
 */
export function OrganizationScopeNote() {
  return (
    <p
      data-testid="organization-scope-note"
      className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground"
    >
      Valores de toda la organización
    </p>
  );
}

/**
 * The four states every analysis block repeats — skeleton, error with retry, a
 * single line when there is nothing worth a table, and the content itself —
 * without the section frame. A block that shares its card with another query
 * renders this twice instead of nesting two sections.
 */
export function QueryBody<T>({
  query,
  loadingLabel,
  loadingRows = 5,
  loadingColumns = 3,
  errorMessage,
  isEmpty,
  emptyText,
  className,
  children,
}: {
  query: ReportQuery<T>;
  loadingLabel: string;
  loadingRows?: number;
  loadingColumns?: number;
  errorMessage: string;
  isEmpty: boolean;
  emptyText: string;
  className?: string;
  children: ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div aria-busy="true" className={className}>
        <TableSkeleton
          rows={loadingRows}
          columns={loadingColumns}
          label={loadingLabel}
          className="border-0 bg-transparent"
        />
      </div>
    );
  }

  if (query.error) {
    return (
      <ErrorState
        message={getApiErrorMessage(query.error, errorMessage)}
        onRetry={() => query.refetch()}
        retryLabel="Reintentar"
        className={cn("min-h-[120px]", className)}
      />
    );
  }

  if (isEmpty) {
    const note = <BlockNote>{emptyText}</BlockNote>;
    return className ? <div className={className}>{note}</div> : note;
  }

  return className ? <div className={className}>{children}</div> : <>{children}</>;
}

/**
 * Section frame plus the four states of a single query. The frame accepts a
 * `className` so a page can stretch it to the height of the card beside it.
 */
export function QuerySection<T>({
  query,
  title,
  icon,
  description,
  loadingLabel,
  loadingRows = 5,
  loadingColumns = 3,
  errorMessage,
  isEmpty,
  emptyText,
  className,
  bodyClassName,
  children,
}: {
  query: ReportQuery<T>;
  title: string;
  icon: LucideIcon;
  description?: ReactNode;
  loadingLabel: string;
  loadingRows?: number;
  loadingColumns?: number;
  errorMessage: string;
  isEmpty: boolean;
  emptyText: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <SectionShell
      title={title}
      icon={icon}
      description={description}
      className={className}
      bodyClassName={bodyClassName}
    >
      <QueryBody
        query={query}
        loadingLabel={loadingLabel}
        loadingRows={loadingRows}
        loadingColumns={loadingColumns}
        errorMessage={errorMessage}
        isEmpty={isEmpty}
        emptyText={emptyText}
      >
        {children}
      </QueryBody>
    </SectionShell>
  );
}
