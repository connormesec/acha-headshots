import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorNote, JerseyBadge, Loading, errorText } from "../../../components/ui";
import { applyReview } from "../../../db/repo";
import { useAsync } from "../../../hooks/useAsync";
import { ensureEmbeddings } from "../../../ml/embed";
import { BlobImage } from "../components/BlobImage";
import { jobHome } from "../components/JobTabs";
import { applySuggestion, jobPeople, suggest, type Suggestion } from "../services/jersey";
import { acceptedMatch, RESOLVED, UNRESOLVED, type Detection } from "../types";
import { loadJobView } from "../view";

const PAGE = 40;

function PersonTile({ person, number, on, tone, onToggle, disabled }: {
  person: Detection; number: number | null; on: boolean; tone: "ours" | "hide" | "recheck"; onToggle: () => void; disabled?: boolean;
}) {
  const label = tone === "ours" ? (on ? "Picked as your team" : "Pick as your team") : on ? "Ticked" : "Unticked, will be left alone";
  return (
    <button type="button" className={`pick pick--${tone} ${on ? "is-on" : ""}`} onClick={onToggle} aria-pressed={on} title={label} disabled={disabled}>
      <BlobImage blobKey={`crop:${person.id}`} alt="" />
      <span className="pick__tick" aria-hidden>{on ? "✓" : ""}</span>
      {number !== null && <span className="pick__badge"><JerseyBadge number={number} size="sm" /></span>}
    </button>
  );
}

const toggle = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export function JerseyPick() {
  const { jobId = "" } = useParams();
  const { data: view, error } = useAsync(() => loadJobView(jobId), [jobId]);
  const people = useMemo(() => (view ? jobPeople(view) : []), [view]);
  const [ours, setOurs] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const [suggestion, setSuggestion] = useState<Suggestion>();
  const [hide, setHide] = useState<Set<string>>(new Set());
  const [recheck, setRecheck] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ hidden: number; rechecked: number }>();

  if (error && !view) return <ErrorNote>{error}</ErrorNote>;
  if (view === undefined) return <Loading />;
  if (view === null) return <ErrorNote>That job isn't in this browser.</ErrorNote>;
  const numberOf = (d: Detection) => {
    const m = acceptedMatch(d);
    return m && RESOLVED.has(d.status) ? view.players.get(m.playerId)?.jerseyNumber ?? null : null;
  };
  const unresolved = people.filter((d) => UNRESOLVED.has(d.status)).length;

  const findOthers = async () => {
    setBusy("Comparing jerseys…");
    setErr(undefined);
    try {
      const { vectors, updated } = await ensureEmbeddings(people, (n, total) => setBusy(`Comparing jerseys (${n} of ${total})…`));
      if (updated.length) await applyReview(jobId, { detections: updated });
      const s = suggest(people, vectors, [...ours]);
      setSuggestion(s);
      setHide(new Set(s.hide.map((p) => p.detection.id)));
      setRecheck(new Set(s.recheck.map((p) => p.detection.id)));
    } catch (e) {
      setErr(`Couldn't compare jerseys: ${errorText(e)}`);
    } finally {
      setBusy(undefined);
    }
  };

  const apply = async () => {
    setBusy("Saving…");
    setErr(undefined);
    try {
      const changed = applySuggestion(view, [...hide], [...recheck]);
      await applyReview(jobId, { detections: changed });
      setDone({ hidden: changed.filter((d) => d.status === "REJECTED").length, rechecked: changed.filter((d) => d.status === "NEEDS_REVIEW").length });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const head = (
    <div className="page-head">
      <div>
        <p className="eyebrow">{view.job.teamName} · {view.job.name}</p>
        <h1>Pick your jersey</h1>
      </div>
      <Link className="button" to={jobHome(view.job)}>← Back</Link>
    </div>
  );

  if (done) {
    return (
      <>
        {head}
        <p className="note note--ok" role="status">
          ✓ Hid {done.hidden} {done.hidden === 1 ? "person" : "people"} as not your team
          {done.rechecked > 0 && ` and sent ${done.rechecked} automatic tag${done.rechecked === 1 ? "" : "s"} back to review`}.
          You can undo any of these from the photo on the Results page.
        </p>
        <div className="callout__actions">
          <Link className="button button--review" to={`/jobs/${jobId}/review`}>Continue reviewing</Link>
          <Link className="button" to={`/jobs/${jobId}`}>Back to results</Link>
        </div>
      </>
    );
  }

  if (suggestion) {
    const nothing = !suggestion.hide.length && !suggestion.recheck.length;
    return (
      <>
        {head}
        {nothing ? (
          <p className="note note--warn">Everyone waiting for review looks like the players you picked, so there's nothing to hide.</p>
        ) : (
          <p className="muted">Everything below is ticked. Click anyone who <strong>is</strong> on your team to untick them, then confirm. Nothing changes until you do.</p>
        )}
        {suggestion.hide.length > 0 && (
          <section>
            <div className="section-head"><h2 className="section-title">Don't look like your team · {hide.size} of {suggestion.hide.length} ticked</h2></div>
            <p className="muted small">Opponents, referees and fans waiting for review. They'll be marked "not a roster player". The last ones in the list are the closest calls.</p>
            <div className="pick-grid">
              {suggestion.hide.map(({ detection: d }) => (
                <PersonTile key={d.id} person={d} number={numberOf(d)} tone="hide" on={hide.has(d.id)} onToggle={() => setHide((s) => toggle(s, d.id))} />
              ))}
            </div>
          </section>
        )}
        {suggestion.recheck.length > 0 && (
          <section>
            <div className="section-head"><h2 className="section-title">Tagged automatically, but the jersey doesn't match · {recheck.size}</h2></div>
            <p className="muted small">Often an opponent wearing one of your roster numbers. Ticked ones go back to the review queue.</p>
            <div className="pick-grid">
              {suggestion.recheck.map(({ detection: d }) => (
                <PersonTile key={d.id} person={d} number={numberOf(d)} tone="recheck" on={recheck.has(d.id)} onToggle={() => setRecheck((s) => toggle(s, d.id))} />
              ))}
            </div>
          </section>
        )}
        {suggestion.stillUnresolved > 0 && (
          <p className="muted">{suggestion.stillUnresolved} {suggestion.stillUnresolved === 1 ? "person looks" : "people look"} like your team and will stay in review.</p>
        )}
        {err && <ErrorNote>{err}</ErrorNote>}
        <div className="callout__actions pick-actions">
          {!nothing && (
            <button className="button button--primary" onClick={apply} disabled={!!busy || hide.size + recheck.size === 0}>
              {busy ?? `Hide ${hide.size}${recheck.size ? ` and re-check ${recheck.size}` : ""}`}
            </button>
          )}
          <button className="button" onClick={() => setSuggestion(undefined)} disabled={!!busy}>Change my picks</button>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <p className="muted">
        Click <strong>2 or 3 of your own players</strong>, ideally in different poses. We then find everyone waiting for review
        who looks nothing like them (the other team, referees, fans) so you can hide them in one go. It compares jerseys and
        gear, not faces, and it can't tell your players apart from each other. It runs in your browser.
      </p>
      {unresolved === 0 && <p className="note note--warn">Nobody in this batch is waiting for review, so there's nothing to hide.</p>}
      <div className="section-head">
        <h2 className="section-title">People in this batch</h2>
        <span className="muted small">Tagged players first</span>
      </div>
      <div className="pick-grid">
        {people.slice(0, shown).map((d) => (
          <PersonTile key={d.id} person={d} number={numberOf(d)} tone="ours" on={ours.has(d.id)} onToggle={() => setOurs((s) => toggle(s, d.id))} disabled={!!busy} />
        ))}
      </div>
      {shown < people.length && <button className="button pick-more" onClick={() => setShown((n) => n + PAGE)}>Show more ({people.length - shown} left)</button>}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="pick-bar">
        <span>{ours.size === 0 ? "No players picked yet" : `${ours.size} picked`}{busy && ` · ${busy}`}</span>
        <button className="button button--primary" onClick={findOthers} disabled={!!busy || ours.size === 0 || unresolved === 0}>
          {busy ? "Comparing…" : "Find who's not on my team"}
        </button>
      </div>
    </>
  );
}
