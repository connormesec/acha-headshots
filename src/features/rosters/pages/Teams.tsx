import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { deleteTeam, listTeams, putPlayer, saveTeam, teamPlayers } from "../../../db/repo";
import { ConfirmModal } from "../../../components/Modal";
import { ErrorNote, JerseyBadge, Loading, errorText, timeAgo } from "../../../components/ui";
import { downloadBlob } from "../../../lib/zipio";
import { useAsync } from "../../../hooks/useAsync";
import type { Player, Team } from "../../sorting/types";
import { rosterApi } from "../api";
import { exportTeams, importTeams } from "../lib/io";
import { applyImport, syncSummary } from "../lib/sync";

function sourceLine(team: Team): string {
  const c = team.sourceConfig;
  if (c?.type === "acha") return `ACHA team ${c.team_id} · ${c.season_id ? `season ${c.season_id}` : "latest season"}`;
  if (c?.type === "puckpress") {
    let host = c.site_url;
    try {
      host = new URL(c.site_url.includes("://") ? c.site_url : `https://${c.site_url}`).host;
    } catch {
      /* show as typed */
    }
    return `Team website · ${host} · roster ${c.roster_id}`;
  }
  return "Entered by hand";
}

function TeamCard({ team, highlight, onChanged }: { team: Team; highlight: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(highlight);
  const [players, setPlayers] = useState<Player[]>();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void teamPlayers(team.id).then(setPlayers);
  }, [team.id]);

  const active = players?.filter((p) => p.active) ?? [];
  const goalieCount = active.filter((p) => p.position === "G").length;

  const toggleGoalie = async (p: Player) => {
    const updated = { ...p, position: p.position === "G" ? null : "G" };
    await putPlayer(updated);
    setPlayers((list) => list?.map((x) => (x.id === p.id ? updated : x)));
  };

  const refresh = async () => {
    if (!team.sourceConfig) return;
    setSyncing(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const imported = await rosterApi.fetch(team.sourceConfig);
      const { players: next, result } = applyImport(team.id, await teamPlayers(team.id), imported);
      await saveTeam({ ...team, lastSyncedAt: new Date().toISOString() }, next);
      setMessage(syncSummary(result));
      setPlayers(await teamPlayers(team.id));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <article className={`team-card ${highlight ? "is-new" : ""}`}>
      <header className="team-card__head">
        <div className="team-card__title">
          <h2>{team.name}</h2>
          <span className="muted small">
            <span className="mono">{team.abbreviation}</span> · {players ? `${active.length} active players` : "…"}
          </span>
          <span className="muted small">
            {sourceLine(team)}
            {team.lastSyncedAt && ` · synced ${timeAgo(team.lastSyncedAt)}`}
          </span>
        </div>
        <div className="team-card__actions">
          {team.source !== "manual" && (
            <button className="button button--small" onClick={refresh} disabled={syncing}>
              {syncing ? "Refreshing…" : "Refresh roster"}
            </button>
          )}
          <button className="button button--small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide roster" : "Show roster"}
          </button>
          <Link className="button button--small button--primary" to={`/jobs/new?team=${team.id}`}>Sort photos</Link>
          <button className="button button--small hs-link" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </header>
      {message && <div className="note note--ok" role="status">Roster refreshed: {message}</div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {open && (
        players ? (
          <>
            <p className="muted small goalie-hint">
              {goalieCount > 0
                ? `${goalieCount} goalie${goalieCount === 1 ? "" : "s"} marked. Goalies are only matched to people who look like goalies, and skaters are never given a goalie's name.`
                : "No goalies marked, so goalie matching is off for this team. Click G next to each goalie."}
              {team.source !== "manual" && " Refresh roster resets these from the source."}
            </p>
            <ul className="roster-preview">
              {active.map((p) => (
                <li key={p.id}>
                  <JerseyBadge number={p.jerseyNumber} size="sm" tone={p.jerseyNumber == null ? "muted" : "home"} />
                  <span>{p.displayName}</span>
                  <button
                    type="button"
                    className={`goalie-toggle ${p.position === "G" ? "is-on" : ""}`}
                    aria-pressed={p.position === "G"}
                    title={p.position === "G" ? `${p.displayName} is a goalie (click to unmark)` : `Mark ${p.displayName} as a goalie`}
                    onClick={() => toggleGoalie(p)}
                  >
                    G
                  </button>
                </li>
              ))}
              {active.length === 0 && <li className="muted">No active players.</li>}
            </ul>
          </>
        ) : <Loading label="Loading roster…" />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${team.name}?`}
          confirmLabel="Delete team"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteTeam(team.id);
            setConfirmDelete(false);
            onChanged();
          }}
        >
          <p>The team and its roster are removed from this browser. Jobs you already ran keep their results.</p>
        </ConfirmModal>
      )}
    </article>
  );
}

export function Teams() {
  const [params] = useSearchParams();
  const created = params.get("created") ?? undefined;
  const { data: teams, error, reload } = useAsync(() => listTeams(), []);
  const [ioMessage, setIoMessage] = useState<string>();
  const [ioError, setIoError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const all = teams ?? [];
    const players = new Map(await Promise.all(all.map(async (t) => [t.id, await teamPlayers(t.id)] as const)));
    const blob = new Blob([JSON.stringify(exportTeams(all, players), null, 2)], { type: "application/json" });
    downloadBlob(blob, "teams.json");
  };

  const doImport = async (file: File | undefined) => {
    setIoError(undefined);
    setIoMessage(undefined);
    if (!file) return;
    try {
      const imported = importTeams(await file.text());
      for (const { team, players } of imported) await saveTeam(team, players);
      setIoMessage(`Added ${imported.length} team${imported.length === 1 ? "" : "s"} from ${file.name}.`);
      await reload();
    } catch (e) {
      setIoError(errorText(e));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Rosters</p>
          <h1>Teams</h1>
        </div>
        <div className="callout__actions">
          {!!teams?.length && <button className="button" onClick={doExport}>Export teams</button>}
          <button className="button" onClick={() => fileInput.current?.click()}>Import teams</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ""; }} />
          <Link to="/teams/new" className="button button--primary">Add team</Link>
        </div>
      </div>
      <p className="muted small">
        Teams are saved in this browser only. Use Export teams to move them to another computer.
      </p>
      {ioMessage && <div className="note note--ok" role="status">{ioMessage}</div>}
      {ioError && <ErrorNote>{ioError}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!teams && !error && <Loading />}
      {teams?.length === 0 && (
        <div className="empty">
          <h2>No teams yet</h2>
          <p>Import a roster from ACHA or your team website, or type one in. Photo sorting matches jersey numbers against it.</p>
          <Link to="/teams/new" className="button button--primary">Add a team</Link>
        </div>
      )}
      <div className="team-list">
        {teams?.map((t) => <TeamCard key={t.id} team={t} highlight={t.id === created} onChanged={reload} />)}
      </div>
    </>
  );
}
