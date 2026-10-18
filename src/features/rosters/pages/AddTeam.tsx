import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { AchaSeason, AchaTeam, ImportedRoster, SourceConfig } from "../../../../shared/roster/imported";
import { useAuth } from "../../../app/AuthContext";
import { ErrorNote, JerseyBadge, errorText } from "../../../components/ui";
import { listTeams, saveTeam } from "../../../db/repo";
import type { Team } from "../../sorting/types";
import { rosterApi } from "../api";
import { applyImport, checkAbbreviation, manualPlayers, parseManual, suggestAbbreviation } from "../lib/sync";

type Mode = "acha" | "puckpress" | "manual";

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "acha", label: "ACHA", hint: "Find the team on the ACHA stats site" },
  { key: "puckpress", label: "Team website", hint: "Sites with the Puck Press roster plugin" },
  { key: "manual", label: "Type it in", hint: "One player per line" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AddTeam() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const offline = me?.offline;
  const [mode, setMode] = useState<Mode>(offline ? "manual" : "acha");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ImportedRoster>();
  const [source, setSource] = useState<SourceConfig>();
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => void listTeams().then(setTeams), []);

  // ACHA
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [results, setResults] = useState<AchaTeam[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<AchaTeam>();
  const [seasons, setSeasons] = useState<AchaSeason[]>([]);
  const [seasonId, setSeasonId] = useState("");

  // Team website
  const [siteUrl, setSiteUrl] = useState("");
  const [rosterId, setRosterId] = useState(1);

  // Manual
  const [manualText, setManualText] = useState("");
  const manual = parseManual(manualText);

  const reset = () => {
    setPreview(undefined);
    setSource(undefined);
    setError(undefined);
  };

  useEffect(() => {
    if (mode !== "acha" || debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    rosterApi.searchAcha(debounced)
      .then((r) => !cancelled && setResults(r))
      .catch((e) => !cancelled && setError(errorText(e)))
      .finally(() => !cancelled && setSearching(false));
    return () => { cancelled = true; };
  }, [debounced, mode]);

  useEffect(() => {
    if (mode === "acha" && !seasons.length && !offline) rosterApi.achaSeasons().then(setSeasons).catch(() => undefined);
  }, [mode, seasons.length, offline]);

  const loadPreview = async (config: SourceConfig) => {
    setLoading(true);
    setError(undefined);
    setPreview(undefined);
    try {
      const p = await rosterApi.fetch(config);
      setPreview(p);
      setSource(config);
      setName((n) => n || p.team_name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const pickAcha = (team: AchaTeam, season = seasonId) => {
    setPicked(team);
    setName(team.nickname ? `${team.name} ${team.nickname}` : team.name);
    void loadPreview({ type: "acha", team_id: team.id, season_id: season || null });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const short = abbr.trim() || suggestAbbreviation(name, teams.map((t) => t.abbreviation));
    const problem = checkAbbreviation(short, teams);
    if (problem) return setError(problem);
    setSaving(true);
    setError(undefined);
    try {
      const id = crypto.randomUUID();
      const team: Team = {
        id, name: name.trim().slice(0, 200), abbreviation: short, source: mode === "manual" ? "manual" : source!.type,
        sourceConfig: mode === "manual" ? null : source!, lastSyncedAt: mode === "manual" ? null : new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      const players = mode === "manual" ? manualPlayers(id, manual) : applyImport(id, [], preview!).players;
      await saveTeam(team, players);
      navigate(`/teams?created=${id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const shown = mode === "manual"
    ? manual.map((p, i) => ({ key: String(i), name: p.displayName, number: p.jerseyNumber, position: p.position }))
    : (preview?.players ?? []).map((p) => ({ key: p.external_id, name: p.display_name, number: p.jersey_number, position: p.position }));
  const ready = name.trim() && (mode === "manual" ? manual.length > 0 : !!preview && !!source);
  const counts = new Map<number, number>();
  for (const p of shown) if (p.number !== null) counts.set(p.number, (counts.get(p.number) ?? 0) + 1);
  const duplicates = [...counts].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);
  const missing = shown.filter((p) => p.number === null).length;

  return (
    <form className="add-team" onSubmit={submit}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Teams</p>
          <h1>Add a team</h1>
        </div>
      </div>
      {offline && (
        <p className="note note--warn">
          Importing a roster needs this site's server, which isn't available here. You can still type the roster in.
        </p>
      )}

      <div className="segmented" role="tablist" aria-label="Roster source">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className={`segmented__option ${mode === m.key ? "is-active" : ""}`}
            onClick={() => { setMode(m.key); reset(); }}
            disabled={offline && m.key !== "manual"}
          >
            <strong>{m.label}</strong>
            <span>{m.hint}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        {mode === "acha" && (
          <>
            <label className="field">
              <span className="field__label">School or nickname</span>
              <input className="search" type="search" value={query} autoFocus placeholder="e.g. Montana State, Bobcats"
                onChange={(e) => { setQuery(e.target.value); setPicked(undefined); reset(); }} />
              <span className="field__hint">Searches the current ACHA men's and women's seasons.</span>
            </label>
            {searching && <p className="muted small">Searching ACHA…</p>}
            {!picked && results.length > 0 && (
              <ul className="acha-results">
                {results.map((t) => (
                  <li key={`${t.id}-${t.season_id}`}>
                    <button type="button" className="acha-result" onClick={() => pickAcha(t)}>
                      <span className="acha-result__nologo" aria-hidden="true" />
                      <span className="acha-result__name">{t.name}</span>
                      <span className="muted small">{[t.nickname, t.division].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && !picked && debounced.trim().length >= 2 && results.length === 0 && !error && (
              <p className="muted small">No ACHA team matches "{debounced}".</p>
            )}
            {picked && (
              <div className="picked">
                <div>
                  <strong>{picked.name}</strong>
                  <span className="muted small"> {[picked.nickname, picked.division].filter(Boolean).join(" · ")} · ACHA id {picked.id}</span>
                </div>
                <label className="field field--inline">
                  <span className="field__label">Season</span>
                  <select value={seasonId} onChange={(e) => { setSeasonId(e.target.value); pickAcha(picked, e.target.value); }}>
                    <option value="">Latest published roster</option>
                    {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <button type="button" className="button button--small" onClick={() => { setPicked(undefined); reset(); }}>Change team</button>
              </div>
            )}
          </>
        )}

        {mode === "puckpress" && (
          <div className="pp-fields">
            <label className="field">
              <span className="field__label">Website</span>
              <input className="search" value={siteUrl} onChange={(e) => { setSiteUrl(e.target.value); reset(); }}
                placeholder="https://yourteam.com" autoFocus />
              <span className="field__hint">A WordPress site running the Puck Press roster plugin.</span>
            </label>
            <label className="field field--narrow">
              <span className="field__label">Roster id</span>
              <input className="search" type="number" min={1} value={rosterId}
                onChange={(e) => { setRosterId(Math.max(1, Number(e.target.value) || 1)); reset(); }} />
              <span className="field__hint">Main roster is 1.</span>
            </label>
            <div className="pp-fields__action">
              <button type="button" className="button" disabled={!siteUrl.trim() || loading}
                onClick={() => loadPreview({ type: "puckpress", site_url: siteUrl, roster_id: rosterId })}>
                {loading ? "Loading…" : "Load roster"}
              </button>
            </div>
          </div>
        )}

        {mode === "manual" && (
          <label className="field">
            <span className="field__label">Players</span>
            <textarea className="search roster-text" rows={10} value={manualText} onChange={(e) => setManualText(e.target.value)}
              placeholder={"27 Bob Johnson\n12 Mike Jones\nTom Wilson, 91"} autoFocus />
            <span className="field__hint">One per line: number then name, or name then number. Add a G at the end for goalies, e.g. 30 Sam Keeper G.</span>
          </label>
        )}

        {loading && mode === "acha" && <p className="muted small">Loading roster…</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </section>

      {shown.length > 0 && (
        <section className="panel">
          <div className="preview-head">
            <h2 className="section-title">Roster · {shown.length} players</h2>
            {preview?.season_name && <span className="pill">{preview.season_name}</span>}
          </div>
          {duplicates.length > 0 && (
            <div className="note note--warn">
              Shared jersey numbers: {duplicates.map((n) => `#${n}`).join(", ")}. Photos of those numbers will always go to review.
            </div>
          )}
          {missing > 0 && (
            <div className="note note--warn">
              {missing} player{missing === 1 ? " has" : "s have"} no jersey number and can only be tagged by hand in review.
            </div>
          )}
          <ul className="roster-preview">
            {shown.map((p) => (
              <li key={p.key}>
                <JerseyBadge number={p.number} size="sm" tone={p.number == null ? "muted" : "home"} />
                <span>{p.name}</span>
                {p.position && <span className="muted small">{p.position}</span>}
              </li>
            ))}
          </ul>

          <div className="team-fields">
            <label className="field">
              <span className="field__label">Team name</span>
              <input className="search" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field field--narrow">
              <span className="field__label">Short name</span>
              <input className="search" value={abbr} onChange={(e) => setAbbr(e.target.value)}
                placeholder={name ? suggestAbbreviation(name, teams.map((t) => t.abbreviation)) : "auto"} maxLength={20} />
            </label>
          </div>
          <div className="actions">
            <button className="button button--primary" type="submit" disabled={!ready || saving}>
              {saving ? "Creating…" : `Create team with ${shown.length} players`}
            </button>
          </div>
        </section>
      )}
    </form>
  );
}
