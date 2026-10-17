import type { ReactNode } from "react";

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="note note--error" role="alert">{children}</div>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The signature element: every roster identity is shown as a varsity jersey number. */
export function JerseyBadge({ number, size = "md", tone = "home" }: {
  number: number | null | undefined;
  size?: "sm" | "md" | "lg";
  tone?: "home" | "review" | "muted";
}) {
  return (
    <span className={`jersey jersey--${size} jersey--${tone}`} aria-label={number == null ? "No number" : `Number ${number}`}>
      {number ?? "–"}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  CREATED: "Queued",
  EXTRACTING: "Unpacking",
  PROCESSING: "Processing",
  PAUSED: "Paused",
  REVIEW: "Needs review",
  COMPLETED: "Completed",
  FAILED: "Failed",
  AUTO_ACCEPTED: "Auto",
  CONFIRMED: "Confirmed",
  NEEDS_REVIEW: "Review",
  UNKNOWN: "Unknown",
  REJECTED: "Not a roster player",
  FILTERED: "Hidden: background",
  PROPOSED: "Candidate",
  NO_PLAYERS: "No players found",
  PROCESSED: "Processed",
};

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "FAILED" ? "bad" :
    status === "REVIEW" || status === "NEEDS_REVIEW" || status === "UNKNOWN" || status === "NO_PLAYERS" || status === "PAUSED" ? "review" :
    status === "COMPLETED" || status === "AUTO_ACCEPTED" || status === "CONFIRMED" ? "good" : "neutral";
  return <span className={`pill pill--${tone}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: "good" | "review" | "bad" }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function SignalBar({ label, value }: { label: string; value: number | null | undefined }) {
  const has = value !== null && value !== undefined;
  const pct = has ? Math.round(value * 100) : 0;
  return (
    <div className={`signal ${has ? "" : "signal--absent"}`}>
      <span className="signal__label">{label}</span>
      <span className="signal__track"><span className="signal__fill" style={{ width: `${pct}%` }} /></span>
      <span className="signal__value">{has ? `${pct}%` : "—"}</span>
    </div>
  );
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
