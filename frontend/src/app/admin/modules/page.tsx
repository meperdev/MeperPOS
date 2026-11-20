"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { useModuleCatalog } from "@/hooks/useAdmin";
import { Boxes, ChevronRight } from "lucide-react";

export default function ModulesPage() {
  const { data: modules, isLoading, isError, refetch } = useModuleCatalog();

  const header = (
    <PageHeader
      title="Módulos"
      subtitle="Capacidades que se activan o desactivan por organización."
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <TableSkeleton rows={3} columns={2} label="Cargando módulos…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState
          message="No se pudieron cargar los módulos."
          retryLabel="Reintentar"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const catalog = modules ?? [];

  return (
    <div className="space-y-4">
      {header}

      <Card>
        <CardContent className="p-0">
          {catalog.length === 0 ? (
            <EmptyState
              icon={<Boxes className="h-4 w-4" />}
              title="No hay módulos disponibles"
              subtitle="El servidor todavía no tiene módulos definidos."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell as="th">Módulo</TableCell>
                  <TableCell as="th" className="text-right">
                    Acciones
                  </TableCell>
                </TableRow>
              </TableHeader>
              <tbody>
                {catalog.map((module) => (
                  <TableRow key={module.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {module.name}
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {module.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/modules/${module.id}`}
                        aria-label={`Ver módulo ${module.name}`}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
                      >
                        Ver módulo
                        <ChevronRight
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
