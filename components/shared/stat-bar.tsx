import { cn } from "@/lib/utils";

const BAR_VARIANT_CLASS = {
  default: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-destructive",
} as const;

/**
 * A single labeled row with a proportional horizontal bar — the "simple
 * visual bar" the Reports page uses for status/priority/type breakdowns
 * instead of pulling in a charting package (see CLAUDE.md's Reports scope:
 * no third-party charting library this pass). Pure presentation: callers
 * pass an already-computed, already-authorized count — this component
 * never fetches or filters anything itself.
 */
export function StatBar({
  label,
  value,
  total,
  variant = "default",
}: {
  label: string;
  value: number;
  total: number;
  variant?: keyof typeof BAR_VARIANT_CLASS;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", BAR_VARIANT_CLASS[variant])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
