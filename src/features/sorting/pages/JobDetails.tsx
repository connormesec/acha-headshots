import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ConfirmModal } from "../../../components/Modal";
import { ErrorNote, Loading, Stat, StatusPill } from "../../../components/ui";
import { deleteJob, getJob, jobPhotos, jobUsage } from "../../../db/repo";
import { JobTabs } from "../components/JobTabs";
import { useJobData } from "../runner";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const secs = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return secs < 60 ? `${secs.toFixed(1)} s` : `${Math.floor(secs / 60)} min ${Math.round(secs % 60)} s`;
}

export function JobDetails() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data, error } = useJobData(async () => {
    const job = await getJob(jobId);
    if (!job) return null;
    const [photos, usage] = await Promise.all([jobPhotos(jobId), jobUsage(jobId)]);
    return { job, failed: photos.filter((p) => p.status === "FAILED"), usage };
  }, [jobId]);

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (data === undefined) return <Loading />;
  if (data === null) return <ErrorNote>That job isn't in this browser.</ErrorNote>;
  const { job, failed, usage } = data;
  const cost = usage.reduce((t, u) => t + u.estimated_cost_usd, 0);
  const byOp = new Map<string, { calls: number; failures: number; input: number; output: number; cost: number; model: string }>();
  for (const u of usage) {
    const k = `${u.model}:${u.operation}`;
    const a = byOp.get(k) ?? { calls: 0, failures: 0, input: 0, output: 0, cost: 0, model: `${u.provider}/${u.model}` };
    a.calls++;
    if (!u.success) a.failures++;
    a.input += u.input_tokens ?? 0;
    a.output += u.output_tokens ?? 0;
    a.cost += u.estimated_cost_usd;
    byOp.set(k, a);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{job.name}</p>
          <h1>{job.teamName}</h1>
        </div>
        <StatusPill status={job.status} />
      </div>
      <JobTabs job={job} active="details" />
      {job.error && <ErrorNote>{job.error}</ErrorNote>}
      {job.visionStopped && <p className="note note--warn">{job.visionStopped}</p>}

      <section className="stats">
        <Stat value={job.counts.total} label="Photos added" />
        <Stat value={job.counts.processed} label="Processed" />
        <Stat value={job.counts.identified} label="Identified" tone="good" />
        <Stat value={job.counts.review} label="Need review" tone="review" />
        <Stat value={job.counts.noPlayers} label="No players found" />
        <Stat value={job.counts.failed} label="Failed" tone={job.counts.failed ? "bad" : undefined} />
        <Stat value={job.skipped.length} label="Files skipped" />
      </section>

      <div className="two-col">
        <section className="panel">
          <h2 className="section-title">Timing</h2>
          <dl className="kv">
            <dt>Added</dt><dd>{fmtDate(job.createdAt)}</dd>
            <dt>Started</dt><dd>{fmtDate(job.startedAt)}</dd>
            <dt>Finished</dt><dd>{fmtDate(job.completedAt)}</dd>
            <dt>Processing time</dt><dd>{duration(job.startedAt, job.completedAt)}</dd>
          </dl>
        </section>

        <section className="panel">
          <h2 className="section-title">AI help</h2>
          {!job.visionRequested && !usage.length ? (
            <p className="muted">Off for this job: numbers were read in the browser only, at no cost.</p>
          ) : (
            <>
              <dl className="kv">
                <dt>Calls</dt><dd>{usage.length}</dd>
                <dt>Failed calls</dt><dd>{usage.filter((u) => !u.success).length}</dd>
                <dt>Estimated cost</dt><dd>${cost.toFixed(4)}</dd>
                <dt>Per photo</dt><dd>{job.counts.total ? `$${(cost / job.counts.total).toFixed(5)}` : "—"}</dd>
              </dl>
              {byOp.size > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Operation</th><th>Model</th><th>Calls</th><th>Tokens in/out</th><th>Cost</th></tr></thead>
                    <tbody>
                      {[...byOp].map(([k, o]) => (
                        <tr key={k}>
                          <td>{k.split(":")[1]}</td>
                          <td>{o.model}</td>
                          <td>{o.calls}{o.failures ? ` (${o.failures} failed)` : ""}</td>
                          <td>{o.input.toLocaleString()} / {o.output.toLocaleString()}</td>
                          <td>${o.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <h2 className="section-title">Failed photos</h2>
        {failed.length === 0 ? <p className="muted">None. Every photo was read successfully.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Photo</th><th>Error</th></tr></thead>
              <tbody>{failed.map((p) => <tr key={p.id}><td>{p.filename}</td><td>{p.error}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Skipped files</h2>
        {job.skipped.length === 0 ? <p className="muted">Nothing skipped.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Reason</th></tr></thead>
              <tbody>{job.skipped.map((s, i) => <tr key={i}><td>{s.name}</td><td>{s.reason}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Remove from this browser</h2>
        <p className="muted">Deletes this job's photos, crops and results from this browser. Your original files aren't touched.</p>
        <div className="actions actions--start">
          <button className="button" onClick={() => setConfirmDelete(true)}>Delete job</button>
        </div>
      </section>
      {confirmDelete && (
        <ConfirmModal title="Delete this job?" confirmLabel="Delete job" onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteJob(jobId);
            navigate(job.kind === "player_bg" ? "/player-bg" : "/jobs", { replace: true });
          }}>
          <p>Its photos and results are removed from this browser. Download the ZIP first if you still need it.</p>
        </ConfirmModal>
      )}
    </>
  );
}
