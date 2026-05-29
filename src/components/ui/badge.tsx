import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-bg-elevated text-ink-muted",
  accent: "bg-accent/15 text-accent",
  save: "bg-accent-save/15 text-accent-save",
  warn: "bg-accent-warn/15 text-accent-warn",
} as const;

interface BadgeProps {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
