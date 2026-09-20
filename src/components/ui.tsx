"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CheckCircle2, Circle, CircleDashed, AlertTriangle, XCircle, Clock } from "lucide-react";
import type { ClarificationStatus, CorrectionStatus, IssueKind, IssueSeverity } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }>(
  function Button({ variant = "primary", size = "md", icon, className, children, ...rest }, ref) {
    const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap";
    const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-9.5 px-4 text-[13.5px]", lg: "h-11 px-5 text-[14.5px]" }[size];
    const variants = {
      primary: "bg-navy text-white hover:bg-navy-2",
      secondary: "bg-surface text-ink border border-border-strong hover:border-ink-3 hover:bg-surface-2",
      ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
      danger: "bg-surface text-red border border-red/40 hover:bg-red-soft",
      success: "bg-green text-white hover:bg-green/90",
    }[variant];
    return (
      <button ref={ref} className={cx(base, sizes, variants, className)} {...rest}>
        {icon}
        {children}
      </button>
    );
  },
);

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx("rounded-lg border border-border bg-surface", padded && "p-5", className)}>{children}</div>;
}

/** A small serif run-in heading, the way a brief labels its sections. `meta` carries a count or qualifier in the interface face. */
export function SectionLabel({ children, meta, className }: { children: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-baseline gap-2", className)}>
      <span className="heading">{children}</span>
      {meta !== undefined && meta !== null && meta !== "" && <span className="text-[12px] text-ink-3">{meta}</span>}
    </div>
  );
}

export function Chip({ children, tone = "neutral", className, dot }: { children: ReactNode; tone?: "neutral" | "navy" | "green" | "amber" | "red" | "blue"; className?: string; dot?: boolean }) {
  const tones = {
    neutral: "bg-surface text-ink-2 border-border-strong",
    navy: "bg-navy-soft text-navy border-navy/30",
    green: "bg-green-soft text-green border-green/30",
    amber: "bg-amber-soft text-amber border-amber/30",
    red: "bg-red-soft text-red border-red/30",
    blue: "bg-blue-soft text-blue border-blue/30",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-[1px] text-[11.5px] font-medium leading-4", tones, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function KindChip({ kind }: { kind: IssueKind }) {
  const map: Record<IssueKind, { label: string; tone: "amber" | "red" | "blue" | "navy" }> = {
    conflict: { label: "Conflict", tone: "red" },
    gap: { label: "Missing period", tone: "amber" },
    omission: { label: "Omission", tone: "blue" },
    clarification: { label: "Needs clarification", tone: "navy" },
  };
  return <Chip tone={map[kind].tone}>{map[kind].label}</Chip>;
}

export function SeverityChip({ severity }: { severity: IssueSeverity }) {
  const map: Record<IssueSeverity, "red" | "amber" | "neutral"> = { high: "red", medium: "amber", low: "neutral" };
  return (
    <Chip tone={map[severity]} dot>
      {severity[0].toUpperCase() + severity.slice(1)}
    </Chip>
  );
}

export function ClarificationStatusChip({ status }: { status: ClarificationStatus | "open" | "skipped" }) {
  switch (status) {
    case "resolved":
      return (
        <Chip tone="green">
          <CheckCircle2 size={12} /> Resolved
        </Chip>
      );
    case "partial":
      return (
        <Chip tone="blue">
          <CircleDashed size={12} /> In progress
        </Chip>
      );
    case "unresolved":
      return (
        <Chip tone="amber">
          <AlertTriangle size={12} /> Unresolved
        </Chip>
      );
    case "skipped":
      return (
        <Chip tone="neutral">
          <Clock size={12} /> Attorney only
        </Chip>
      );
    default:
      return (
        <Chip tone="neutral">
          <Circle size={12} /> Open
        </Chip>
      );
  }
}

export function CorrectionStatusChip({ status }: { status: CorrectionStatus }) {
  switch (status) {
    case "proposed":
      return (
        <Chip tone="navy">
          <CircleDashed size={12} /> Proposed
        </Chip>
      );
    case "unresolved":
      return (
        <Chip tone="amber">
          <AlertTriangle size={12} /> Unresolved
        </Chip>
      );
    case "accepted":
      return (
        <Chip tone="green">
          <CheckCircle2 size={12} /> Accepted
        </Chip>
      );
    case "edited":
      return (
        <Chip tone="green">
          <CheckCircle2 size={12} /> Accepted with edits
        </Chip>
      );
    case "rejected":
      return (
        <Chip tone="red">
          <XCircle size={12} /> Rejected
        </Chip>
      );
  }
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}
