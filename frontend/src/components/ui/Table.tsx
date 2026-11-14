"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TableVariant = "primary" | "accent" | "default";

interface TableContextValue {
  variant: TableVariant;
  isHeader: boolean;
}

const TableContext = createContext<TableContextValue>({
  variant: "default",
  isHeader: false,
});

const headerRowClasses: Record<TableVariant, string> = {
  primary: "border-b border-border/60 bg-muted/35",
  accent: "border-b border-border/60 bg-muted/35",
  default: "border-b border-border/60 bg-muted/35",
};

const bodyRowClasses: Record<TableVariant, string> = {
  primary:
    "border-b border-border/50 transition-colors hover:bg-muted/30 last:border-b-0",
  accent:
    "border-b border-border/50 transition-colors hover:bg-muted/30 last:border-b-0",
  default:
    "border-b border-border/50 transition-colors hover:bg-muted/30 last:border-b-0",
};

interface TableProps {
  variant?: TableVariant;
  className?: string;
  children: ReactNode;
}

export function Table({
  variant = "default",
  className,
  children,
}: TableProps) {
  return (
    <TableContext.Provider value={{ variant, isHeader: false }}>
      <table className={cn("w-full text-sm", className)}>{children}</table>
    </TableContext.Provider>
  );
}

interface TableHeaderProps {
  className?: string;
  children: ReactNode;
}

export function TableHeader({ className, children }: TableHeaderProps) {
  const { variant } = useContext(TableContext);
  return (
    <TableContext.Provider value={{ variant, isHeader: true }}>
      <thead className={className}>{children}</thead>
    </TableContext.Provider>
  );
}

interface TableRowProps extends React.ComponentPropsWithoutRef<"tr"> {
  className?: string;
  children: ReactNode;
}

export function TableRow({ className, children, ...props }: TableRowProps) {
  const { variant, isHeader } = useContext(TableContext);
  const rowClasses = isHeader
    ? headerRowClasses[variant]
    : bodyRowClasses[variant];
  return (
    <tr className={cn(rowClasses, className)} {...props}>
      {children}
    </tr>
  );
}

interface TableCellProps {
  as?: "td" | "th";
  className?: string;
  children: ReactNode;
}

export function TableCell({
  as = "td",
  className,
  children,
}: TableCellProps) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        "py-3 px-5 text-xs",
        as === "th" && "text-left font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </Comp>
  );
}
