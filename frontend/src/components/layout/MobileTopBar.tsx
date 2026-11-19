"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { AlertCenter } from "@/components/layout/AlertCenter";
import { openCommandPalette } from "@/lib/command-palette";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { isNestedPath, parentPath, resolveSectionLabel } from "./nav-routes";

/**
 * The phone's top bar. Two things lead the row: a back chevron on nested routes
 * and the section's name, taken from the same map the rail paints its labels
 * from. The bell stays on the right; the hamburger moved to the tab bar's "Más",
 * and the brand mark lives in the drawer, because at 390px a logo would compete
 * with the title for the same 200px.
 *
 * The title is chrome, not content: the page keeps its own `h1` (`PageHeader`
 * hides it below `lg` instead of removing it), so the document never has two.
 */
export function MobileTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const isNested = isNestedPath(pathname);
  const title = resolveSectionLabel(pathname);

  const goBack = () => {
    // An installed app launched from the home screen has no in-app history, so
    // `back()` would leave the app (or do nothing). Route depth is the fallback:
    // /sales/123 returns to /sales, /purchase-orders/new to the list.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(parentPath(pathname));
  };

  return (
    <header
      className={cn(
        "lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2",
        "bg-card border-b border-border",
        "h-[calc(var(--mobile-header)+var(--safe-top))] pt-[var(--safe-top)]",
        "pl-[calc(1rem+var(--safe-left))] pr-[calc(1rem+var(--safe-right))]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {isNested && (
          <button
            type="button"
            onClick={goBack}
            aria-label="Volver"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted active:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <p
          data-testid="mobile-topbar-title"
          className={cn(
            "min-w-0 truncate font-semibold tracking-tight text-foreground",
            isNested ? "text-base" : "text-lg",
          )}
        >
          {title}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        {/* Same palette as the desktop field: the phone gets the glyph, not the
            44px-wide shortcut hint that has no keyboard to press it. */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={`Buscar en ${APP_NAME}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted active:text-foreground"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>

        <AlertCenter className="shrink-0" />
      </div>
    </header>
  );
}
