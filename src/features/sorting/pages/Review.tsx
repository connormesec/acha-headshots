import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ErrorNote, Loading, errorText } from "../../../components/ui";
import { applyReview } from "../../../db/repo";
import { useAsync } from "../../../hooks/useAsync";
import { JobTabs } from "../components/JobTabs";
import { PhotoFrame } from "../components/PhotoFrame";
import { activeCandidates, ReviewPanel } from "../components/ReviewPanel";
import { assignPlayer, confirmMatch, markPhotoReviewed, markUnknown, tagWholePhoto } from "../services/review";
import { reviewQueue, type ReviewItem } from "../services/stats";
import type { Detection, Match, Photo, Player } from "../types";
import { loadJobView, type JobView } from "../view";

const itemKey = (i: ReviewItem) => (i.kind === "detection" ? `d${i.detectionId}` : `p${i.photo.id}`);

export function Review() {
  const { jobId = "" } = useParams();
  const [params] = useSearchParams();
  // Photo mode (?photo=<id>): every person in one photo, including ones already identified or
  // hidden as background. Otherwise: the queue of undecided people.
  const photoId = params.get("photo") ?? undefined;
  const photoMode = photoId !== undefined;
  const { data: initial, error } = useAsync(() => loadJobView(jobId), [jobId, photoId]);
  // Live copy: review actions update it in place, so positions in the queue stay stable.
  const [view, setView] = useState<JobView | null>();
  useEffect(() => setView(initial), [initial]);
  const queue = useMemo(
    () => (initial ? reviewQueue(initial.photos, initial.detections, { includeResolved: photoMode, photoId }) : []),
    [initial, photoMode, photoId],
  );
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [lastAction, setLastAction] = useState<string>();
  useEffect(() => {
    setDecisions({});
    setIndex(0);
  }, [initial]);

  const item: ReviewItem | undefined = queue[index];
  const remaining = queue.filter((i) => !decisions[itemKey(i)]).length;
  const photo: Photo | undefined = item && view?.photos.find((p) => p.id === item.photo.id);
  const people = useMemo(() => (view && photo ? view.detections.filter((d) => d.photoId === photo.id).sort((a, b) => a.index - b.index) : []), [view, photo]);
  const detection = item?.kind === "detection" ? people.find((d) => d.id === item.detectionId) ?? null : null;
  const roster = useMemo(() => [...(view?.players.values() ?? [])].filter((p) => p.active)
    .sort((a, b) => (a.jerseyNumber ?? 1000) - (b.jerseyNumber ?? 1000)), [view]);

  const go = useCallback((delta: number) => {
    setActionError(undefined);
    setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(queue.length - 1, 0)));
  }, [queue.length]);

  const act = useCallback(async (label: string, change: (v: JobView) => { detections?: Detection[]; photos?: Photo[] }) => {
    if (!item || !view || busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const c = change(view);
      const job = await applyReview(jobId, c);
      const dets = new Map(view.detections.map((d) => [d.id, d]));
      for (const d of c.detections ?? []) dets.set(d.id, d);
      const photos = new Map(view.photos.map((p) => [p.id, p]));
      for (const p of c.photos ?? []) photos.set(p.id, p);
      setView({ ...view, job, detections: [...dets.values()], photos: view.photos.map((p) => photos.get(p.id)!) });
      const decided = { ...decisions, [itemKey(item)]: label };
      const where = item.kind === "detection" ? `person ${(detection?.index ?? 0) + 1} in ${item.photo.filename}` : item.photo.filename;
      setLastAction(`${label} for ${where}`);
      setDecisions(decided);
      const next = queue.findIndex((q, i) => i > index && !decided[itemKey(q)]);
      const wrap = queue.findIndex((q) => !decided[itemKey(q)]);
      if (next >= 0) setIndex(next);
      else if (wrap >= 0) setIndex(wrap);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [item, view, busy, jobId, decisions, detection, queue, index]);

  const name = (p: Player) => `${p.displayName} #${p.jerseyNumber ?? "–"}`;
  const choose = useCallback((m: Match) => {
    const p = view?.players.get(m.playerId);
    if (detection && p) void act(`Confirmed ${name(p)}`, () => ({ detections: [confirmMatch(detection, m.id)] }));
  }, [view, detection, act]);
  const assign = useCallback((p: Player) => {
    if (!item || !photo) return;
    if (item.kind === "detection" && detection) void act(`Assigned ${name(p)}`, () => ({ detections: [assignPlayer(detection, p)] }));
    else void act(`Assigned ${name(p)}`, () => {
      const out = tagWholePhoto(photo, people.length, p);
      return { photos: [out.photo], detections: [out.detection] };
    });
  }, [item, photo, detection, people.length, act]);
  const unknown = useCallback(() => {
    if (!item || !photo) return;
    if (item.kind === "detection" && detection) void act("Marked as not a roster player", () => ({ detections: [markUnknown(detection)] }));
    else void act("Marked as having no roster players", () => ({ photos: [markPhotoReviewed(photo)] }));
  }, [item, photo, detection, act]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const cands = activeCandidates(detection);
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key.toLowerCase() === "u") unknown();
      else if (e.key === "Enter" && cands[0] && target.tagName !== "BUTTON") choose(cands[0]);
      else if (/^[1-9]$/.test(e.key) && cands[Number(e.key) - 1]) choose(cands[Number(e.key) - 1]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detection, go, unknown, choose]);

  if (error && !view) return <ErrorNote>{error}</ErrorNote>;
  if (view === undefined) return <Loading />;
  if (view === null) return <ErrorNote>That job isn't in this browser.</ErrorNote>;

  const header = (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{view.job.teamName}</p>
          <h1>{photoMode ? "Photo review" : "Review"}</h1>
        </div>
        {photoMode && <Link className="button" to={`/jobs/${jobId}`}>← Back to results</Link>}
      </div>
      <JobTabs job={view.job} active="review" />
    </>
  );

  if (!photoMode && (queue.length === 0 || remaining === 0)) {
    return (
      <>
        {header}
        {lastAction && <div className="note note--ok" role="status">✓ {lastAction}</div>}
        <div className="empty">
          <h2>{queue.length === 0 ? "Nothing to review" : "Review complete"}</h2>
          <p>Every detected player is either identified or marked as not on the roster. You can export the sorted photos now.</p>
          <Link className="button button--primary" to={view.job.kind === "player_bg" ? `/player-bg/${jobId}` : `/jobs/${jobId}`}>
            {view.job.kind === "player_bg" ? "Go to backgrounds" : "Go to results and export"}
          </Link>
        </div>
      </>
    );
  }
  if (photoMode && queue.length === 0) {
    return (
      <>
        {header}
        <div className="empty">
          <h2>Nothing to review in this photo</h2>
          <p>It failed to process, so there are no people to tag.</p>
          <Link className="button button--primary" to={`/jobs/${jobId}`}>Back to results</Link>
        </div>
      </>
    );
  }
  if (!item || !photo) return <Loading />;

  return (
    <>
      {header}
      <div className="review-bar">
        <div className="review-bar__nav">
          <button className="button button--small" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous">← Prev</button>
          <span><b>{index + 1}</b> / {queue.length}</span>
          <button className="button button--small" onClick={() => go(1)} disabled={index >= queue.length - 1} aria-label="Next">Next →</button>
        </div>
        <span className="muted">
          {photoMode ? `${queue.length} ${queue.length === 1 ? "person" : "people"} in this photo · ${Object.keys(decisions).length} changed` : `${remaining} left to decide`}
        </span>
        <span className="shortcuts muted small">
          <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>Enter</kbd> confirm · <kbd>U</kbd> not on roster · <kbd>←</kbd><kbd>→</kbd> move
        </span>
      </div>
      {lastAction && !actionError && <div className="note note--ok" role="status">✓ {lastAction}</div>}
      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      <div className="review">
        <section className="review__photo">
          <PhotoFrame photo={photo} detections={people} activeId={detection?.id} />
          <div className="review__caption">
            <span className="mono">{photo.filename}</span>
            {item.kind === "detection" && people.length > 1 && (
              <span>Player {(detection?.index ?? 0) + 1} of {people.length} in this photo, each reviewed separately</span>
            )}
          </div>
        </section>
        <ReviewPanel key={itemKey(item)} item={item} detection={detection} players={view.players} roster={roster} busy={busy}
          decision={decisions[itemKey(item)]} onChoose={choose} onAssign={assign} onUnknown={unknown} />
      </div>
    </>
  );
}
