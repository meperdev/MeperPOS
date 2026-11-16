"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
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
  return <p className="py-1 text-xs text-muted-foreground">{children}</p>;
}

/**
 * Section frame plus the four states every analysis block repeats: skeleton,
 * error with retry, a single line when there is nothing worth a table, and the
 * content itself.
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
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <SectionShell title={title} icon={icon} description={description} bodyClassName={bodyClassName}>
      {query.isLoading ? (
        <div aria-busy="true">
          <TableSkeleton
            rows={loadingRows}
            columns={loadingColumns}
            label={loadingLabel}
            className="border-0 bg-transparent"
          />
        </div>
      ) : query.error ? (
        <ErrorState
          message={getApiErrorMessage(query.error, errorMessage)}
          onRetry={() => query.refetch()}
          retryLabel="Reintentar"
          className="min-h-[120px]"
        />
      ) : isEmpty ? (
        <BlockNote>{emptyText}</BlockNote>
      ) : (
        children
      )}
    </SectionShell>
  );
}
