import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../../app/AuthContext";
import { ErrorNote, errorText, plural } from "../../../components/ui";
import { listTeams, teamPlayers } from "../../../db/repo";
import { useAsync } from "../../../hooks/useAsync";
import { classify, defaultName, filesFromDrop, formatSize, type Picked } from "../../../lib/ingest";
import { SORTING } from "../config";
import { createJob } from "../jobs";
import { MOCK_CV, warmUp } from "../pipeline/browserProviders";
import { startJob } from "../runner";
import type { JobKind } from "../types";

const COPY: Record<JobKind, { eyebrow: string; title: string; hint?: string }> = {
  sort: { eyebrow: "Photo sorting", title: "Sort a photo batch" },
  player_bg: {
    eyebrow: "Player page bg",
    title: "Find player page backgrounds",
    hint: "Add game action shots. We identify each player, pick their best shot and crop it to a wide 1080 × 440 header.",
  },
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export function NewJob({ kind = "sort" }: { kind?: JobKind }) {
  const copy = COPY[kind];
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { me } = useAuth();
  const { data: teams, error: teamsError } = useAsync(async () => {
    const all = await listTeams();
    return Promise.all(all.map(async (t) => {
      const players = (await teamPlayers(t.id)).filter((p) => p.active);
      return { team: t, players: players.length, goalies: players.filter((p) => p.position === "G").length };
    }));
  }, []);
  const [teamId, setTeamId] = useState<string>();
  const [picked, setPicked] = useState<Picked>();
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ai, setAi] = useState(true);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!teams?.length || teamId !== undefined) return;
    const wanted = params.get("team");
    setTeamId(teams.some((t) => t.team.id === wanted) ? wanted! : teams[0].team.id);
  }, [teams, teamId, params]);

  // Start the model download while the user picks photos.
  useEffect(() => void warmUp().catch(() => undefined), []);

  const choose = (files: File[]) => {
    setError(undefined);
    const result = classify(files, SORTING.maxPhotos);
    if (typeof result === "string") return setError(result);
    setPicked(result);
    if (!name) setName(defaultName(files, result) || (result.kind === "photos" ? `${result.files.length} photos` : ""));
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) choose(await filesFromDrop(e));
  };

  const entry = teams?.find((t) => t.team.id === teamId);
  const canAi = !!me?.admin && me.visionAvailable;
  const useAi = canAi && ai;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked || !entry) return;
    setBusy(true);
    setError(undefined);
    try {
      const job = await createJob({ kind, team: entry.team, picked, name, visionRequested: useAi, goalieDetection: false });
      startJob(job.id, { admin: !!me?.admin });
      navigate(`/jobs/${job.id}/processing`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const size = picked ? (picked.kind === "zip" ? picked.file.size : picked.files.reduce((t, f) => t + f.size, 0)) : 0;
  const spend = me?.spend;

  return (
    <form className="new-job" onSubmit={submit}>
      <div className="page-head">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
        </div>
      </div>
      {copy.hint && <p className="muted">{copy.hint}</p>}
      {teamsError && <ErrorNote>{teamsError}</ErrorNote>}
      {teams?.length === 0 && (
        <div className="note note--warn">
          Add a team first: sorting matches jersey numbers against its roster. <Link to="/teams/new">Add a team</Link>
        </div>
      )}

      <section className="panel">
        <label className="field">
          <span className="field__label">Team</span>
          <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)} disabled={busy || !teams?.length}>
            {teams?.map(({ team, players }) => <option key={team.id} value={team.id}>{team.name} ({players} players)</option>)}
          </select>
          <span className="field__hint">
            Jersey numbers are matched against this team's roster. Team not listed? <Link to="/teams/new">Add a team</Link>
          </span>
        </label>

        <div
          className={`dropzone ${dragging ? "is-dragging" : ""} ${picked ? "has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={filesInput} data-testid="sort-files-input" type="file" multiple accept=".zip,image/*,.heic,.heif,.tif,.tiff" hidden
            onChange={(e) => { choose(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <input ref={(el) => { folderInput.current = el; el?.setAttribute("webkitdirectory", ""); }} type="file" hidden
            onChange={(e) => { choose(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          {picked ? (
            <>
              <strong className="dropzone__file">{picked.kind === "zip" ? picked.file.name : plural(picked.files.length, "photo")}</strong>
              <span>{formatSize(size)}{picked.kind === "photos" && picked.skipped.length ? ` · ${picked.skipped.length} skipped` : ""}</span>
            </>
          ) : (
            <>
              <strong>Drop a ZIP, a folder or photos here</strong>
              <span>Up to {SORTING.maxPhotos.toLocaleString()} photos. JPG, PNG, HEIC, WebP, TIFF and more; everything else is skipped.</span>
            </>
          )}
          <div className="dropzone__buttons">
            <button type="button" className="button button--small" onClick={() => filesInput.current?.click()} disabled={busy}>Choose ZIP or photos</button>
            <button type="button" className="button button--small" onClick={() => folderInput.current?.click()} disabled={busy}>Choose a folder</button>
          </div>
        </div>

        {picked && (
          <label className="field hs-name">
            <span className="field__label">Batch name</span>
            <input className="search" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. vs Montana, Oct 4" />
          </label>
        )}

        {canAi ? (
          <label className="ai-toggle">
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} disabled={busy} />
            <span>
              <b>AI help for numbers the local reader can't make out</b> (admin only)
              <span className="muted small">
                Sends a small crop of just those players to OpenAI. Usually well under a cent per player.
                {spend && ` Spent today ${usd(spend.dayUsd)} of ${usd(spend.dayCapUsd)}, this month ${usd(spend.monthUsd)} of ${usd(spend.monthCapUsd)}.`}
              </span>
            </span>
          </label>
        ) : me?.admin ? (
          <p className="muted small">AI help is unavailable right now (no OpenAI key on the server, or the spending limit is reached), so this batch uses the local number reader only.</p>
        ) : (
          <p className="muted small">
            Numbers are read in your browser, for free. Players it can't read go to a quick review where you pick them.
            {me?.loginAvailable && <> Admins can also <Link to="/admin">log in</Link> for AI help.</>}
          </p>
        )}
        {MOCK_CV && <p className="note note--warn">Demo mode (?mockcv): people and numbers come from the file names, not the photos.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="actions">
          <button className="button button--primary" type="submit" disabled={!picked || !entry || busy}>
            {busy ? "Saving the photos in this browser…" : `Start${entry ? ` for ${entry.team.name}` : ""}`}
          </button>
        </div>
      </section>
    </form>
  );
}
