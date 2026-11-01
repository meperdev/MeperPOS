"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { cn } from "@/lib/utils";
import { Building2, LayoutDashboard, LogOut, Loader2 } from "lucide-react";

const navItems = [
  { href: "/admin", label: "Panel" },
  { href: "/admin/organizations", label: "Organizaciones" },
] as const;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && (!user || user.role !== "SUPER_ADMIN")) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  if (loading) {
    return <LoadingState icon={<Loader2 className="h-8 w-8" />} message="Verificando acceso..." />;
  }

  if (!user || user.role !== "SUPER_ADMIN") {
    return null;
  }

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 text-foreground">
                <Building2 className="h-4 w-4" />
              </span>
              <span className="truncate text-sm font-semibold tracking-tight text-foreground">
                MeperPOS
              </span>
              <span className="shrink-0 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                SuperAdmin
              </span>
            </Link>

            <nav
              aria-label="Secciones de administración"
              className="ml-1 flex items-center gap-1 overflow-x-auto"
            >
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px] transition-colors duration-150",
                    isActive(item.href)
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex min-w-0 items-center justify-between gap-2 lg:justify-end">
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:block">
              {user.email}
            </span>
            <div className="flex items-center gap-1.5">
              <Link
                href="/dashboard"
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Ir al panel
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
