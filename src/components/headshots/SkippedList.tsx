import type { Batch } from "../../state/types";
import { plural } from "../ui";

/** Files that won't be in the download: couldn't be opened, or skipped at ingest. */
export function SkippedList({ batch, open = false }: { batch: Batch; open?: boolean }) {
  const failed = batch.items.filter((i) => i.status === "FAILED");
  const skipped = batch.skipped;
  if (!failed.length && !skipped.length) return null;
  const parts = [
    failed.length ? `${plural(failed.length, "file")} couldn't be opened` : "",
    skipped.length ? `${skipped.length} skipped` : "",
  ].filter(Boolean);
  return (
    <details className="hs-details hs-skipped" open={open}>
      <summary>{parts.join(" · ")}. These won't be in your download.</summary>
      <ul>
        {failed.map((i) => <li key={i.id}><b>{i.original_filename}</b>: {i.error_message}</li>)}
        {skipped.map((s, n) => <li key={`${s.name}-${n}`}><b>{s.name}</b>: {s.reason}</li>)}
      </ul>
    </details>
  );
}
