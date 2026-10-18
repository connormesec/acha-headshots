import { Link } from "react-router";
import { listJobs } from "../../../db/repo";
import { ErrorNote, Loading, StatusPill, timeAgo } from "../../../components/ui";
import { jobHome } from "../components/JobTabs";
import { useJobData, useRunState } from "../runner";
import { ACTIVE_JOB, type Job, type JobKind } from "../types";

const COPY: Record<JobKind, { eyebrow: string; title: string; newLabel: string; newTo: string; intro: string; empty: string }> = {
  sort: {
    eyebrow: "Photo sorting", title: "Sort game photos", newLabel: "Sort a batch", newTo: "/jobs/new",
    intro: "Add a game's photos and pick the team. Each player is matched by jersey number against the roster, and you get one folder per player.",
    empty: "Add a ZIP or a folder of game photos. Players are matched by jersey number against the team's roster.",
  },
  player_bg: {
    eyebrow: "Player page bg", title: "Player page backgrounds", newLabel: "Find backgrounds", newTo: "/player-bg/new",
    intro: "Add game action shots. Each player is identified, their best shot picked and cropped to a wide 1080 × 440 header, named like max-haims.jpg.",
    empty: "Action shots work best: landscape photos where the player is big, sharp and mid-play.",
  },
};

export const isActive = (job: Job) => ACTIVE_JOB.has(job.status) || job.status === "PAUSED";

export function jobLink(job: Job): string {
  if (isActive(job)) return `/jobs/${job.id}/processing`;
  if (job.status === "FAILED") return `/jobs/${job.id}/details`;
  return jobHome(job);
}

export function JobList({ kind }: { kind: JobKind }) {
  const copy = COPY[kind];
  const { running } = useRunState();
  const { data: jobs, error } = useJobData(async () => (await listJobs()).filter((j) => j.kind === kind), [kind]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
        </div>
        <Link to={copy.newTo} className="button button--primary">{copy.newLabel}</Link>
      </div>
      <p className="muted">{copy.intro} Photos stay in this browser.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!jobs && !error && <Loading />}
      {jobs?.length === 0 && (
        <div className="empty">
          <h2>No batches yet</h2>
          <p>{copy.empty}</p>
          <Link to={copy.newTo} className="button button--primary">{copy.newLabel}</Link>
        </div>
      )}
      <ul className="job-list">
        {jobs?.map((job) => {
          const interrupted = isActive(job) && running !== job.id;
          return (
            <li key={job.id}>
              <Link to={jobLink(job)} className="job-row">
                <div className="job-row__team">
                  <span className="job-row__name">{job.teamName}</span>
                  <span className="job-row__file">{job.name} · {timeAgo(job.createdAt)}{job.visionRequested ? " · AI help" : ""}</span>
                </div>
                <div className="job-row__counts">
                  <span><b>{job.counts.total}</b> photos</span>
                  <span className="c-good"><b>{job.counts.identified}</b> identified</span>
                  <span className={job.counts.review ? "c-review" : ""}><b>{job.counts.review}</b> review</span>
                  {job.counts.failed > 0 && <span className="c-bad"><b>{job.counts.failed}</b> failed</span>}
                </div>
                <StatusPill status={interrupted ? "PAUSED" : job.status} />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
