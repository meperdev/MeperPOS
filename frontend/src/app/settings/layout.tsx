"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { settingsSections } from "./sections";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        <PageHeader
          title="Configuración"
          subtitle="Ajusta la configuración del sistema"
        />

        {/*
          @container must wrap the element whose layout switches: a container query never
          matches on the container itself, so putting it on the flex shell left @4xl:flex-row
          dead and stacked the nav above the content.
        */}
        <div className="@container">
          <div className="flex flex-col @4xl:flex-row @4xl:gap-6">
            <nav
              aria-label="Secciones de configuración"
              className="@4xl:w-56 @4xl:shrink-0"
            >
              <ul className="flex flex-wrap items-center gap-1.5 @4xl:sticky @4xl:top-6 @4xl:flex-col @4xl:items-stretch @4xl:gap-1">
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
                          "inline-flex @4xl:flex h-9 items-center gap-2 rounded-lg px-3 text-xs whitespace-nowrap transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
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

            <div className="flex-1 min-w-0 mt-4 @4xl:mt-0">{children}</div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
