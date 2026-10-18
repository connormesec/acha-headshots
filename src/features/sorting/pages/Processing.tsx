import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../../app/AuthContext";
import { ErrorNote, Loading, Stat, StatusPill } from "../../../components/ui";
import { getJob } from "../../../db/repo";
import { jobHome } from "../components/JobTabs";
import { pauseJob, startJob, useJobData, useRunState } from "../runner";
import { isActive } from "./JobList";

export function Processing() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const run = useRunState();
  const { data: job, error } = useJobData(() => getJob(jobId), [jobId]);
  const running = run.running === jobId;
  const queued = run.queued.includes(jobId);
  const progress = run.progress[jobId];

  // Opening an unfinished job carries on with it (after a closed tab, or a pause).
  useEffect(() => {
    const held = run.paused.includes(jobId) || !!run.error[jobId];
    if (job && isActive(job) && job.status !== "PAUSED" && !running && !queued && !held && me) startJob(job.id, { admin: me.admin });
  }, [job, running, queued, me, run.paused, run.error, jobId]);

  useEffect(() => {
    if (job && (job.status === "REVIEW" || job.status === "COMPLETED")) {
      const t = window.setTimeout(() => navigate(jobHome(job), { replace: true }), 900);
      return () => window.clearTimeout(t);
    }
  }, [job, navigate]);

  if (error && !job) return <ErrorNote>{error}</ErrorNote>;
  if (job === undefined) return <Loading />;
  if (!job) return <ErrorNote>That job isn't in this browser.</ErrorNote>;

  const total = progress?.total ?? job.counts.total;
  const done = progress?.done ?? job.counts.processed;
  const percent = total ? Math.round((100 * done) / total) : 0;
  const active = isActive(job);
  const paused = active && !running && !queued;
  const heading = run.loading === jobId ? "Getting the photo models ready"
    : running ? "Finding players and reading jersey numbers"
    : queued ? "Waiting for the job before it"
    : paused ? "Paused"
    : job.status === "FAILED" ? "Processing stopped" : "Done";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{job.teamName} · {job.name}</p>
          <h1>{heading}</h1>
        </div>
        <StatusPill status={paused ? "PAUSED" : job.status} />
      </div>

      <section className="panel">
        <div className="meter meter--large" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span className={`meter__fill ${running ? "is-live" : ""}`} style={{ width: `${percent}%` }} />
          <span className="meter__label">{total ? `${done} of ${total} photos` : "Counting photos…"}</span>
        </div>
        <div className="stats">
          <Stat value={job.counts.total} label="Photos" />
          <Stat value={job.counts.identified} label="Identified" tone="good" />
          <Stat value={job.counts.review} label="Need review" tone="review" />
          <Stat value={job.counts.failed} label="Failed" tone={job.counts.failed ? "bad" : undefined} />
        </div>
        <p className="muted small">
          Everything runs in this browser: keep this tab open. If you close it, open the job again to carry on where it stopped.
          {job.visionRequested && " AI help is on for players the local reader can't make out."}
        </p>
        {run.error[jobId] && <ErrorNote>{run.error[jobId]}</ErrorNote>}
        {job.status === "FAILED" && (
          <ErrorNote>{job.error ?? "The job failed."} <Link to={`/jobs/${jobId}/details`}>See job details</Link></ErrorNote>
        )}
        <div className="actions">
          {(running || queued) && <button className="button" onClick={() => pauseJob(jobId)}>Pause</button>}
          {paused && <button className="button button--primary" onClick={() => startJob(jobId, { admin: !!me?.admin })}>Continue</button>}
          {!active && job.status !== "FAILED" && <Link className="button button--primary" to={jobHome(job)}>View results</Link>}
        </div>
      </section>
    </>
  );
}
