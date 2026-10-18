import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Stepper } from "../../../components/Stepper";
import { ErrorNote, JerseyBadge, Loading, StatusPill, errorText, formatBytes, plural } from "../../../components/ui";
import { jobPicks, savePicks } from "../../../db/repo";
import { JobTabs } from "../../sorting/components/JobTabs";
import { isActive } from "../../sorting/pages/JobList";
import { useJobData } from "../../sorting/runner";
import type { BgPick } from "../../sorting/types";
import { loadJobView } from "../../sorting/view";
import { BannerCropEditor } from "../components/BannerCropEditor";
import { needsLook, PlayerBgCard } from "../components/PlayerBgCard";
import { BANNER_ASPECT, BG_HEIGHT, BG_MAX_BYTES, BG_WIDTH } from "../lib/bannerCrop";
import { exportBackgrounds, orderPicks, outputNames } from "../lib/export";
import { choose, collectCandidates, resetCrop, setCrop, syncPicks } from "../lib/picks";

export const PLAYER_BG_STEPS = ["Identify players", "Pick & crop", "Download"] as const;

export function PlayerBgJob() {
  const { jobId = "" } = useParams();
  const { data: loaded, error } = useJobData(async () => {
    const view = await loadJobView(jobId);
    if (!view) return null;
    const candidates = collectCandidates(view);
    const { picks, put, remove } = syncPicks(jobId, candidates, await jobPicks(jobId));
    if (put.length || remove.length) await savePicks(put, remove);
    return { view, candidates, picks };
  }, [jobId]);
  const [picks, setPicks] = useState<BgPick[]>();
  useEffect(() => setPicks(loaded?.picks), [loaded]);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [exporting, setExporting] = useState<{ done: number; total: number }>();
  const [built, setBuilt] = useState<number>();

  const update = useCallback(async (pick: BgPick, change: (p: BgPick) => BgPick) => {
    setBusy(pick.id);
    setActionError(undefined);
    try {
      const next = change(pick);
      await savePicks([next]);
      setPicks((list) => list?.map((p) => (p.id === next.id ? next : p)));
      setBuilt(undefined);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  }, []);

  if (error && !loaded) return <ErrorNote>{error}</ErrorNote>;
  if (loaded === undefined || (loaded && !picks)) return <Loading />;
  if (loaded === null) return <ErrorNote>That job isn't in this browser.</ErrorNote>;
  const { view, candidates } = loaded;
  const { job } = view;
  const all = picks!;

  const head = (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Player page bg · {job.name}</p>
          <h1>{job.teamName}</h1>
        </div>
        <StatusPill status={job.status} />
      </div>
      <JobTabs job={job} active="backgrounds" />
    </>
  );

  if (isActive(job)) {
    return (
      <div className="hs-flow hs-flow--wide">
        <Stepper current={0} steps={PLAYER_BG_STEPS} />
        {head}
        <section className="panel">
          <p>Still finding players and reading jersey numbers ({job.counts.processed} of {job.counts.total} photos).</p>
          <Link className="button" to={`/jobs/${jobId}/processing`}>Watch progress</Link>
        </section>
      </div>
    );
  }
  if (job.status === "FAILED") {
    return <div className="hs-flow hs-flow--wide">{head}<ErrorNote>{job.error ?? "The job failed."} <Link to={`/jobs/${jobId}/details`}>See job details</Link></ErrorNote></div>;
  }

  const names = outputNames(all, view.players);
  const ordered = orderPicks(all, view.players);
  const included = ordered.filter((p) => p.included);
  const look = included.filter(needsLook);
  const good = included.filter((p) => !needsLook(p));
  const out = ordered.filter((p) => !p.included);
  const editingPick = all.find((p) => p.id === editing);
  const editingCandidate = editingPick && candidates.get(editingPick.playerId)?.find((c) => c.detection.id === editingPick.detectionId);
  const missing = [...view.players.values()].filter((p) => p.active && !candidates.has(p.id))
    .sort((a, b) => (a.jerseyNumber ?? 1000) - (b.jerseyNumber ?? 1000));

  const buildZip = async () => {
    setExporting({ done: 0, total: included.length });
    setActionError(undefined);
    try {
      setBuilt(await exportBackgrounds(view, all, (done, total) => setExporting({ done, total })));
      setPicks(await jobPicks(jobId).then((ps) => ps));
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setExporting(undefined);
    }
  };

  const card = (pick: BgPick) => (
    <PlayerBgCard key={pick.id} pick={pick} player={view.players.get(pick.playerId)!} candidates={candidates.get(pick.playerId) ?? []}
      outputName={names.get(pick.id) ?? ""} aspect={BANNER_ASPECT} busy={busy === pick.id}
      onEdit={() => setEditing(pick.id)}
      onChoose={(detectionId) => update(pick, (p) => choose(p, candidates, detectionId))}
      onInclude={(inc) => update(pick, (p) => ({ ...p, included: inc }))} />
  );

  return (
    <div className="hs-flow hs-flow--wide">
      <Stepper current={built ? 2 : 1} steps={PLAYER_BG_STEPS} />
      {head}

      <section className="callouts">
        {job.counts.review > 0 && (
          <div className="callout callout--review">
            <div>
              <strong>{plural(job.counts.review, "photo")} still need a decision</strong>
              <span>Players you confirm in review get a background here automatically.</span>
            </div>
            <div className="callout__actions">
              <Link className="button" to={`/jobs/${jobId}/jersey`}>Pick your jersey</Link>
              <Link className="button button--review" to={`/jobs/${jobId}/review`}>Start review</Link>
            </div>
          </div>
        )}
        <div className="callout">
          <div>
            <strong>{plural(included.length, "player")} ready</strong>
            <span>One JPEG per player, exactly {BG_WIDTH} × {BG_HEIGHT} and under {formatBytes(BG_MAX_BYTES)}, named like <code>{names.values().next().value ?? "max-haims.jpg"}</code>.</span>
          </div>
          <div className="callout__actions">
            <button className="button button--primary" onClick={buildZip} disabled={!!exporting || included.length === 0}>
              {exporting ? `Making ${exporting.done} of ${exporting.total}…` : "Download ZIP"}
            </button>
          </div>
        </div>
      </section>
      {built !== undefined && <div className="note note--ok" role="status">ZIP made with {plural(built, "player photo")} and manifest.csv.</div>}
      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      {all.length === 0 && (
        <div className="empty">
          <h2>No identified players yet</h2>
          <p>Review the photos so we know who's who, then come back here.</p>
        </div>
      )}
      {look.length > 0 && (
        <section>
          <h2 className="section-title c-review">Needs a look ({look.length})</h2>
          <div className="hs-grid bg-grid">{look.map(card)}</div>
        </section>
      )}
      {good.length > 0 && (
        <section>
          <h2 className="section-title">{look.length ? `Looks good (${good.length})` : `Players (${good.length})`}</h2>
          <p className="muted small hs-tip">We picked each player's best shot. Click a different thumbnail to swap it, or the banner to adjust the crop.</p>
          <div className="hs-grid bg-grid">{good.map(card)}</div>
        </section>
      )}
      {out.length > 0 && (
        <section>
          <h2 className="section-title">Left out ({out.length})</h2>
          <div className="hs-grid bg-grid">{out.map(card)}</div>
        </section>
      )}
      {missing.length > 0 && (
        <section>
          <h2 className="section-title">No shot found ({missing.length})</h2>
          <p className="muted small hs-tip">These roster players weren't identified in any photo. Add more shots of them in a new batch, or tag them in review.</p>
          <ul className="bg-missing">
            {missing.map((p) => <li key={p.id}><JerseyBadge number={p.jerseyNumber} size="sm" tone="muted" /> {p.displayName}</li>)}
          </ul>
        </section>
      )}

      {editingPick && editingCandidate && (
        <BannerCropEditor key={editingPick.id} pick={editingPick} player={view.players.get(editingPick.playerId)!} candidate={editingCandidate}
          outputName={names.get(editingPick.id) ?? ""}
          onClose={() => setEditing(undefined)}
          onSave={async (c) => { await update(editingPick, (p) => setCrop(p, candidates, view, c.x, c.y, c.w)); setEditing(undefined); }}
          onReset={async () => { await update(editingPick, (p) => resetCrop(p, candidates)); setEditing(undefined); }} />
      )}
    </div>
  );
}
