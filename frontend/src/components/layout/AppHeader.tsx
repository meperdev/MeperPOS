"use client";

import { Search } from "lucide-react";
import { AlertCenter } from "@/components/layout/AlertCenter";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { openCommandPalette } from "@/lib/command-palette";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The desktop header: one bar above the content column, holding the three
 * things that are not a destination — search, notifications and the account.
 *
 * It sits right of the rail and follows its collapsed width, so the rail keeps
 * the left edge at every size. Below `lg` the phone keeps `MobileTopBar`, which
 * carries the same three surfaces in the space a thumb can reach.
 */
export function AppHeader({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <header
      data-testid="app-header"
      className={cn(
        "sticky top-0 z-40 hidden h-[var(--app-header-height)] items-center gap-3 lg:flex",
        "border-b border-border bg-background/95 px-8 backdrop-blur-sm",
        // Changing the rail's width has to move this bar with it, exactly like
        // the content column: one transition, one duration.
        "transition-[margin] duration-300 ease-in-out",
        isCollapsed ? "lg:ml-[72px]" : "lg:ml-[256px]",
      )}
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3">
        <div className="flex min-w-0 flex-1 justify-center">
          {/* A button, not an input: it looks like the field it opens, but a
              real field here would type into nothing until the palette mounted. */}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label={`Buscar en ${APP_NAME}`}
            aria-keyshortcuts="Control+K Meta+K"
            className={cn(
              "flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 text-sm text-muted-foreground transition-colors",
              "hover:border-border hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">
              Buscar en {APP_NAME}
            </span>
            <kbd
              aria-hidden="true"
              className="hidden shrink-0 items-center rounded border border-border/70 bg-background px-1.5 py-0.5 id-text text-xs font-medium text-muted-foreground sm:inline-flex"
            >
              Ctrl K
            </kbd>
          </button>
        </div>

        <div
          data-app-header-actions=""
          className="flex shrink-0 items-center gap-1"
        >
          {/* The same bell the rail footer mounts: one component, one ledger.
              The header names its own placement, because here the panel has to
              hang under this row instead of growing out of the sidebar. */}
          <AlertCenter placement="header" />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
