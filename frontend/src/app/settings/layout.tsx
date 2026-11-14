"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { settingsSections } from "./sections";
import { cn } from "@/lib/utils";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            Configuración
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ajusta la configuración del sistema
          </p>
        </div>

        <div className="flex flex-col lg:flex-row lg:gap-6">
          <nav
            aria-label="Secciones de configuración"
            className="lg:w-56 lg:shrink-0"
          >
            <ul className="flex flex-wrap items-center gap-1.5 lg:sticky lg:top-6 lg:flex-col lg:items-stretch lg:gap-1">
              {settingsSections.map((section) => {
                const isActive =
                  pathname === section.href ||
                  pathname.startsWith(`${section.href}/`);
                const Icon = section.icon;

                return (
                  <li key={section.key} className="shrink-0">
                    <Link
                      href={section.href}
                      scroll={false}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "inline-flex lg:flex h-9 items-center gap-2.5 rounded-lg px-3 text-xs whitespace-nowrap transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border",
                        isActive
                          ? "bg-muted/70 text-foreground font-semibold border border-border/70 shadow-2xs"
                          : "text-muted-foreground font-medium border border-transparent hover:text-foreground hover:bg-muted/40",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <span>{section.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex-1 min-w-0 mt-4 lg:mt-0">{children}</div>
        </div>
      </div>
    </DashboardLayout>
  );
}
