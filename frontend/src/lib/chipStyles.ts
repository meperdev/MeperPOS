export const chipStyles = {
  success: "border-success/30 bg-success/10 text-success-text",
  danger: "border-danger/30 bg-danger/10 text-danger-text",
  warning: "border-warning/30 bg-warning/10 text-warning-text",
  info: "border-info/30 bg-info/10 text-info-text",
  neutral: "border-border bg-muted text-foreground",
  secondary: "border-border bg-muted text-foreground",
  primary: "border-primary/30 bg-primary/10 text-primary-text",
  accent: "border-accent/30 bg-accent/10 text-primary-text",
} as const;

export function getTrendChipClass(isPositive: boolean) {
  return isPositive ? chipStyles.success : chipStyles.danger;
}
