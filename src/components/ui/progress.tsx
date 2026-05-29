import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number; // 0..100
  className?: string;
  tone?: "accent" | "save";
}

export function Progress({ value, className, tone = "accent" }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-bg-elevated", className)}>
      <div
        className={cn("h-full transition-all", tone === "save" ? "bg-accent-save" : "bg-accent")}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
