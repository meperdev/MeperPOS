"use client";

import { Moon, Search, Sun } from "lucide-react";
import { AlertCenter } from "@/components/layout/AlertCenter";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { formatSidebarClock } from "@/components/layout/sidebar-clock";
import { useClockNow } from "@/components/layout/use-clock-now";
import { useTheme } from "@/contexts/ThemeContext";
import { openCommandPalette } from "@/lib/command-palette";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The desktop header: one bar above the content column, holding the few things
 * that are not a destination — search, the current time, the light/dark mode,
 * notifications and the account.
 *
 * It sits right of the rail and follows its collapsed width, so the rail keeps
 * the left edge at every size. Below `lg` the phone keeps `MobileTopBar`, which
 * carries the same surfaces in the space a thumb can reach.
 */
export function AppHeader({ isCollapsed }: { isCollapsed: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const now = useClockNow();

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
          {/* The time leads the actions as quiet text. Nothing renders before
              mount (the server has no viewer clock), and the row is right
              aligned, so its arrival only grows the row leftwards. */}
          {now && (
            <time
              data-testid="app-header-clock"
              dateTime={now.toISOString()}
              className="mr-2 whitespace-nowrap text-[13px] text-muted-foreground"
            >
              {formatSidebarClock(now)}
            </time>
          )}
          {/* The mode lives here, next to the inbox and the identity: the three
              controls that change how the surface reads, not where it takes
              you. It stacks in reading order, so the toggle is the first
              decision and the avatar the last. */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"
            }
            title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {isDark ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
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
