import { cn } from "@/lib/utils";

interface SettingsCardProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  tone?: "primary" | "accent";
  /** Header-right controls, e.g. a card-level button. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsCard({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: SettingsCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-border/60">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="text-muted-foreground shrink-0 [&_svg]:text-muted-foreground">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
