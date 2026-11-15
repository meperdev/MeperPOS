"use client";

import { cn } from "@/lib/utils";

const pulse = "animate-pulse motion-reduce:animate-none";

/**
 * First-paint shell shown while the httpOnly session cookie is exchanged for an
 * access token. It mirrors the real layout geometry — same rail width, same
 * main margins — so the swap to the authenticated chrome is a fill-in, not a
 * full-page blank followed by a jump.
 */
export function AppShellSkeleton({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <div className="contents" data-testid="app-shell-skeleton">
      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-14 z-50 flex items-center gap-3 px-4 bg-card border-b border-border">
        <div className={cn("h-9 w-9 rounded-lg bg-muted", pulse)} />
        <div className={cn("h-5 w-28 rounded bg-muted", pulse)} />
      </header>

      {/* Desktop rail */}
      <aside
        aria-hidden="true"
        className={cn(
          "hidden lg:flex fixed top-0 bottom-0 left-0 z-50 flex-col",
          "bg-card border-r border-border/80",
          "transition-[width] duration-300 ease-in-out",
          isCollapsed ? "w-[72px]" : "w-[320px]"
        )}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Brand lockup */}
          <div
            className={cn(
              "shrink-0 border-b border-border/70",
              isCollapsed
                ? "px-2 py-4 flex flex-col items-center gap-3"
                : "px-5 py-5 flex items-center justify-between gap-3"
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div
                className={cn(
                  "rounded-xl bg-muted",
                  pulse,
                  isCollapsed ? "h-11 w-11" : "h-14 w-14"
                )}
              />
              {!isCollapsed && (
                <div className={cn("h-7 w-32 rounded bg-muted", pulse)} />
              )}
            </div>
            {!isCollapsed && (
              <div className={cn("h-7 w-7 rounded-lg bg-muted/70", pulse)} />
            )}
          </div>

          {/* Navigation rows */}
          <div
            className={cn(
              "flex-1 min-h-0 overflow-hidden",
              isCollapsed ? "px-2 py-3 space-y-2" : "px-3 py-3 space-y-1"
            )}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <div
                key={row}
                className={cn(
                  "flex items-center rounded-md",
                  pulse,
                  isCollapsed ? "h-9 w-9 mx-auto" : "h-9 gap-2.5 px-2"
                )}
                style={{ animationDelay: `${row * 60}ms` }}
              >
                {!isCollapsed && (
                  <>
                    <div className="h-4 w-4 shrink-0 rounded bg-muted" />
                    <div
                      className="h-3 rounded bg-muted"
                      style={{ width: `${[62, 48, 54, 70, 56, 44, 66, 50][row]}%` }}
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Account block: clock, identity and the account menu, fused */}
          <div
            className={cn(
              "shrink-0 border-t border-border/70",
              isCollapsed ? "px-2 py-3" : "px-3 py-3"
            )}
          >
            {isCollapsed ? (
              <div className={cn("flex flex-col items-center gap-2", pulse)}>
                <div className="h-3.5 w-9 rounded bg-muted" />
                <div className="h-8 w-8 rounded-md bg-muted" />
                <div className="h-7 w-7 rounded-md bg-muted/70" />
              </div>
            ) : (
              <>
                <div className={cn("flex items-start justify-between gap-2", pulse)}>
                  <div className="min-w-0 space-y-2">
                    <div className="h-6 w-24 rounded bg-muted" />
                    <div className="h-2.5 w-32 rounded bg-muted/70" />
                  </div>
                  <div className="h-7 w-7 shrink-0 rounded-md bg-muted/70" />
                </div>
                <div
                  className={cn(
                    "mt-3 flex items-center gap-2.5 border-t border-border/60 pt-2.5",
                    pulse
                  )}
                >
                  <div className="h-8 w-8 shrink-0 rounded-md bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-2.5 w-16 rounded bg-muted/70" />
                  </div>
                  <div className="h-7 w-7 shrink-0 rounded-md bg-muted/70" />
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Content */}
      <main
        className={cn(
          "px-4 pb-6 pt-20 lg:px-8 lg:pb-8 lg:pt-8 transition-[margin] duration-300 ease-in-out",
          isCollapsed ? "lg:ml-[72px]" : "lg:ml-[320px]"
        )}
      >
        <div className="mx-auto w-full max-w-[1600px] space-y-5" aria-hidden="true">
          <div className="space-y-2">
            <div className={cn("h-7 w-52 rounded bg-muted", pulse)} />
            <div className={cn("h-3 w-72 max-w-full rounded bg-muted/70", pulse)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((card) => (
              <div
                key={card}
                className={cn(
                  "h-24 rounded-xl border border-border/60 bg-muted/30",
                  pulse
                )}
                style={{ animationDelay: `${card * 80}ms` }}
              />
            ))}
          </div>

          <div
            className={cn(
              "h-72 rounded-xl border border-border/60 bg-muted/20",
              pulse
            )}
          />
        </div>
      </main>
    </div>
  );
}
