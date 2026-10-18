import { Link } from "react-router";
import type { Job } from "../types";

/** Results · Review · Job details, for a sorting job (player page background jobs add their own). */
export function JobTabs({ job, active }: { job: Job; active: "results" | "review" | "details" | "backgrounds" }) {
  const tabs = [
    ...(job.kind === "player_bg" ? [{ key: "backgrounds", label: "Backgrounds", to: `/player-bg/${job.id}` }] : []),
    { key: "results", label: "Results", to: `/jobs/${job.id}` },
    { key: "review", label: "Review", to: `/jobs/${job.id}/review` },
    { key: "details", label: "Job details", to: `/jobs/${job.id}/details` },
  ];
  return (
    <nav className="tabs" aria-label="Job sections">
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} className={`tabs__tab ${active === t.key ? "is-active" : ""}`} aria-current={active === t.key ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export const jobHome = (job: Job) => (job.kind === "player_bg" ? `/player-bg/${job.id}` : `/jobs/${job.id}`);
