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
