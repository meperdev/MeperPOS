import { cn } from "@/lib/utils";

interface CardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

// Extra div attributes (role, tabIndex, aria-label, onKeyDown) pass through so a
// clickable card can also be a keyboard edit target.
export function Card({ children, className = "", onClick, ...props }: CardProps) {
  return (
    <div
      {...props}
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border/70 bg-card shadow-2xs transition-colors duration-150",
        onClick &&
          "cursor-pointer hover:border-border hover:bg-muted/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border/60 px-5 py-4", className)}>
      {children}
    </div>
  );
}

export function CardContent({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function CardFooter({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-t border-border/60 px-5 py-4", className)}>
      {children}
    </div>
  );
}
