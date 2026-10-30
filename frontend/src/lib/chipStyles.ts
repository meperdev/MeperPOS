export const chipStyles = {
  success:
    "bg-emerald-500/12 text-emerald-950 border border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300 dark:border-emerald-500/25",
  danger:
    "bg-rose-500/12 text-rose-950 border border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300 dark:border-rose-500/25",
  warning:
    "bg-amber-500/12 text-amber-950 border border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300 dark:border-amber-500/25",
  neutral:
    "bg-slate-200 text-slate-950 border border-slate-500/80 dark:bg-slate-400/12 dark:text-slate-200 dark:border-slate-400/25",
  secondary:
    "bg-stone-200 text-stone-950 border border-stone-500/80 dark:bg-stone-400/12 dark:text-stone-200 dark:border-stone-400/25",
  primary:
    "bg-primary/12 text-primary border border-primary/30 dark:bg-primary/15 dark:text-primary dark:border-primary/30",
  accent:
    "bg-accent/12 text-accent border border-accent/30 dark:bg-accent/15 dark:text-accent dark:border-accent/30",
} as const;

export function getTrendChipClass(isPositive: boolean) {
  return isPositive ? chipStyles.success : chipStyles.danger;
}
