import { useState, type FormEvent } from "react";
import { ErrorNote, Loading, errorText } from "../components/ui";
import { authApi } from "./api";
import { useAuth } from "./AuthContext";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Admin login, and this month's AI spend once logged in. */
export function AdminLogin() {
  const { me, setMe } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!me) return <Loading />;

  if (me.admin) {
    const capped = me.spend && (me.spend.dayUsd >= me.spend.dayCapUsd || me.spend.monthUsd >= me.spend.monthCapUsd);
    return (
      <section className="admin-login">
        <p className="eyebrow">Admin</p>
        <h1>You're logged in</h1>
        <p>
          AI help for unreadable jersey numbers is {me.visionAvailable ? "available" : "unavailable"} on your
          sorting jobs. Turn it on or off for each job when you start it.
        </p>
        {me.spend && (
          <dl className="kv">
            <dt>Spent today</dt><dd>{usd(me.spend.dayUsd)} of {usd(me.spend.dayCapUsd)}</dd>
            <dt>Spent this month</dt><dd>{usd(me.spend.monthUsd)} of {usd(me.spend.monthCapUsd)}</dd>
          </dl>
        )}
        {!me.visionAvailable && (
          <p className="note note--warn">
            {capped
              ? "The spending limit is reached, so AI help is paused until it resets."
              : "The server has no OpenAI key, so AI help is off. Jobs still run with the local number reader."}
          </p>
        )}
      </section>
    );
  }

  if (!me.loginAvailable) {
    return (
      <section className="admin-login">
        <p className="eyebrow">Admin</p>
        <h1>Admin login is off</h1>
        <p className="muted">
          {me.offline
            ? "This copy of the site has no server, so there's no admin login. Every tool still works in your browser."
            : "The server has no admin password set. Every tool still works, and AI help stays off."}
        </p>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setMe(await authApi.login(password));
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-login" onSubmit={submit}>
      <p className="eyebrow">Admin</p>
      <h1>Admin login</h1>
      <p className="field__hint">
        Every tool is open to everyone. Admins can also use AI help for jersey numbers, which costs money per photo.
      </p>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          className="search"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="button button--primary" type="submit" disabled={busy || !password}>
        {busy ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
