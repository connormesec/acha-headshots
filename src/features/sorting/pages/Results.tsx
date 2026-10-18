import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorNote, JerseyBadge, Loading, Stat, StatusPill, errorText, plural } from "../../../components/ui";
import { BlobImage } from "../components/BlobImage";
import { JobTabs } from "../components/JobTabs";
import { useJobData } from "../runner";
import { exportJob } from "../services/exportZip";
import { byPhoto, photoNeedsReview, photoTags, summary, type PlayerTag } from "../services/stats";
import type { Photo } from "../types";
import { loadJobView } from "../view";

type Filter = "all" | "identified" | "review" | "unidentified" | "failed";
interface Tile { photo: Photo; tags: PlayerTag[]; review: boolean }

const FILTERS: { key: Filter; label: string; test: (t: Tile) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "identified", label: "Identified", test: (t) => t.tags.length > 0 },
  { key: "review", label: "Needs review", test: (t) => t.review },
  { key: "unidentified", label: "No roster player", test: (t) => !t.review && !t.tags.length && t.photo.status !== "FAILED" },
  { key: "failed", label: "Failed", test: (t) => t.photo.status === "FAILED" },
];

const reviewLink = (jobId: string, photoId: string) => `/jobs/${jobId}/review?photo=${photoId}`;

function PhotoTile({ jobId, tile }: { jobId: string; tile: Tile }) {
  const { photo, tags, review } = tile;
  const body = (
    <>
      <BlobImage blobKey={photo.status === "FAILED" ? null : `thumb:${photo.id}`} alt="" className="photo-tile__img" />
      <span className="photo-tile__meta">
        {tags.map((t) => <JerseyBadge key={t.playerId} number={t.jerseyNumber} size="sm" />)}
        {photo.status === "FAILED" && <StatusPill status="FAILED" />}
        {review && <StatusPill status="NEEDS_REVIEW" />}
        {photo.status !== "FAILED" && !review && !tags.length && <span className="muted small">No roster player</span>}
      </span>
      <span className="photo-tile__name">{photo.filename}</span>
    </>
  );
  if (photo.status === "FAILED") return <div className="photo-tile photo-tile--failed" title={photo.error ?? ""}>{body}</div>;
  return <Link className="photo-tile" to={reviewLink(jobId, photo.id)} title="Check or change who's tagged">{body}</Link>;
}

export function Results() {
  const { jobId = "" } = useParams();
  const { data: view, error } = useJobData(() => loadJobView(jobId), [jobId]);
  const [filter, setFilter] = useState<Filter>("all");
  const [exporting, setExporting] = useState<{ done: number; total: number }>();
  const [exportError, setExportError] = useState<string>();
  const [exported, setExported] = useState(false);

  const derived = useMemo(() => {
    if (!view) return null;
    const people = byPhoto(view.detections);
    const tiles: Tile[] = view.photos.map((photo) => {
      const ds = people.get(photo.id) ?? [];
      return { photo, tags: photoTags(ds, view.players), review: photoNeedsReview(photo, ds.map((d) => d.status)) };
    });
    return { tiles, ...summary(view.photos, view.detections, view.players) };
  }, [view]);

  if (error && !view) return <ErrorNote>{error}</ErrorNote>;
  if (view === null) return <ErrorNote>That job isn't in this browser.</ErrorNote>;
  if (view === undefined || !derived) return <Loading />;
  const { job } = view;
  const { counts } = job;
  const active = FILTERS.find((f) => f.key === filter)!;

  const doExport = async () => {
    setExportError(undefined);
    setExported(false);
    setExporting({ done: 0, total: 1 });
    try {
      if (await exportJob(view, (done, total) => setExporting({ done, total }))) setExported(true);
    } catch (e) {
      setExportError(errorText(e));
    } finally {
      setExporting(undefined);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{job.name}</p>
          <h1>{job.teamName}</h1>
        </div>
        <StatusPill status={job.status} />
      </div>
      <JobTabs job={job} active="results" />

      <section className="stats stats--hero">
        <Stat value={counts.total} label="Total photos" />
        <Stat value={counts.identified} label="Fully identified" tone="good" />
        <Stat value={counts.review} label="Need review" tone="review" />
        <Stat value={counts.failed} label="Failed" tone={counts.failed ? "bad" : undefined} />
      </section>

      {job.visionStopped && <p className="note note--warn">{job.visionStopped}</p>}

      <section className="callouts">
        {job.kind === "player_bg" && (
          <div className="callout">
            <div>
              <strong>Player page backgrounds</strong>
              <span>Pick each player's best action shot and download the 1080 × 440 headers.</span>
            </div>
            <div className="callout__actions"><Link className="button button--primary" to={`/player-bg/${jobId}`}>Pick & crop</Link></div>
          </div>
        )}
        {counts.review > 0 ? (
          <div className="callout callout--review">
            <div>
              <strong>{plural(counts.review, "photo")} need a decision</strong>
              <span>Unclear numbers, unreadable jerseys and photos where nobody was found. Tip: <b>Pick your jersey</b> first to hide the other team in one go.</span>
            </div>
            <div className="callout__actions">
              <Link className="button" to={`/jobs/${jobId}/jersey`} title="Hide the other team, refs and fans in one go">Pick your jersey</Link>
              <Link className="button button--review" to={`/jobs/${jobId}/review`}>Start review</Link>
            </div>
          </div>
        ) : (
          <div className="callout callout--good">
            <div>
              <strong>Every photo is sorted</strong>
              <span>{derived.automatic} automatic and {derived.confirmed} reviewer-confirmed player tags. Click any photo below to change a tag.</span>
            </div>
          </div>
        )}
        <div className="callout">
          <div>
            <strong>Export</strong>
            <span>A ZIP of your original photos with one folder per player, a NEEDS REVIEW folder, and manifest.csv.</span>
          </div>
          <div className="callout__actions">
            <button className="button button--primary" onClick={doExport} disabled={!!exporting}>
              {exporting ? `Zipping ${exporting.done} of ${exporting.total}…` : "Download ZIP"}
            </button>
          </div>
        </div>
        {exported && <div className="note note--ok" role="status">ZIP saved.</div>}
        {exportError && <ErrorNote>{exportError}</ErrorNote>}
      </section>

      <h2 className="section-title">Players</h2>
      {derived.players.length === 0 && <p className="muted">No players identified yet. Confirmed reviews will show up here.</p>}
      <div className="roster-grid">
        {derived.players.map((b) => (
          <article key={b.player.id} className="player-card">
            <header className="player-card__head">
              <JerseyBadge number={b.player.jerseyNumber} size="lg" />
              <div>
                <h3>{b.player.displayName}</h3>
                <span className="muted">{plural(b.photos.length, "photo")}{b.confirmed > 0 && ` · ${b.confirmed} confirmed`}</span>
              </div>
            </header>
            <div className="thumbs">
              {b.photos.slice(0, 8).map((p) => (
                <Link key={p.id} to={reviewLink(jobId, p.id)} title={`Review ${p.filename}`}>
                  <BlobImage blobKey={`thumb:${p.id}`} alt={p.filename} />
                </Link>
              ))}
              {b.photos.length > 8 && <span className="thumbs__more">+{b.photos.length - 8}</span>}
            </div>
          </article>
        ))}
      </div>

      <div className="section-head">
        <h2 className="section-title">All photos</h2>
        <div className="chips" role="group" aria-label="Filter photos">
          {FILTERS.map((f) => {
            const count = derived.tiles.filter(f.test).length;
            return (
              <button key={f.key} type="button" className={`chip ${filter === f.key ? "is-active" : ""}`} aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)} disabled={count === 0 && f.key !== "all"}>
                {f.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="muted small">Click a photo to check or change who's tagged, including people hidden as fans in the stands.</p>
      <div className="photo-grid">
        {derived.tiles.filter(active.test).map((t) => <PhotoTile key={t.photo.id} jobId={jobId} tile={t} />)}
      </div>
    </>
  );
}
