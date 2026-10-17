/** A progress meter for long steps (finding faces, shrinking photos). */
export function Working({ label, done, total, hint }: { label: string; done: number; total: number; hint: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="panel hs-working">
      <div className="meter meter--large" aria-label={label}>
        <span className="meter__fill is-live" style={{ width: `${Math.max(pct, 4)}%` }} />
        <span className="meter__label">{total ? `${label}… ${done} of ${total}` : `${label}…`}</span>
      </div>
      <p className="muted">{hint}</p>
    </section>
  );
}
