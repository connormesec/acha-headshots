import { useState } from "react";
import { formatBytes } from "../components/HeadshotCard";
import { ConfirmModal } from "../../../components/Modal";
import { Stepper } from "../../../components/Stepper";
import { Working } from "../components/Working";
import { plural } from "../../../components/ui";
import { useBatch } from "../state/BatchContext";
import type { Batch } from "../state/types";

export function ExportScreen({ batch }: { batch: Batch }) {
  const { download, clear, setBackToCrops } = useBatch();
  const [clearing, setClearing] = useState(false);
  const ready = batch.items.filter((i) => i.status === "READY");
  const failed = batch.items.filter((i) => i.status === "FAILED");
  const included = ready.filter((i) => i.included);
  const out = ready.filter((i) => !i.included);

  return (
    <div className="hs-flow">
      <Stepper current={2} onSelect={(s) => s === 1 && setBackToCrops(true)} canSelect={(s) => s === 1 && batch.status === "COMPRESSED"} />
      <div className="page-head"><div><p className="eyebrow">Step 3 of 3 · {batch.name}</p><h1>Download for ACHA</h1></div></div>
      {batch.status === "COMPRESSING" ? (
        <Working label="Shrinking photos" done={batch.compressed} total={included.length}
          hint="Making each photo exactly 1000 × 1500 and under 2 MB. Keep this tab open." />
      ) : (
        <>
          <section className="panel hs-success">
            <div className="hs-success__check" aria-hidden="true">✓</div>
            <div>
              <h2>{plural(included.length, "photo")} ready for ACHA</h2>
              <p>Every one is exactly <b>1000 × 1500</b> and under <b>2 MB</b>.</p>
              <button type="button" className="button button--primary button--big" onClick={download}>Download ZIP</button>
              <p className="hs-expiry">Your photos never leave your device. Everything happens in your browser.</p>
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title">Next: upload to ACHA</h2>
            <ol className="hs-next">
              <li><b>Unzip</b> the download (double-click it).</li>
              <li>On ACHA, open each player's profile and <b>upload their photo</b>. The files have the names you gave them.</li>
              <li>Need to change something? <button type="button" className="hs-inline-link" onClick={() => setBackToCrops(true)}>Go back to the crops</button>, then download again.</li>
            </ol>
          </section>

          <details className="panel hs-details">
            <summary>File details ({included.length} files{out.length + failed.length ? `, ${out.length + failed.length} not included` : ""})</summary>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>File</th><th>Size</th><th>Dimensions</th><th /></tr></thead>
                <tbody>
                  {included.map((i) => (
                    <tr key={i.id}><td>{i.output_name}</td><td>{formatBytes(i.output_bytes)}</td><td>1000 × 1500</td><td className="c-good">✓</td></tr>
                  ))}
                  {out.map((i) => (
                    <tr key={i.id} className="muted"><td>{i.output_name}</td><td colSpan={3}>Left out (your choice)</td></tr>
                  ))}
                  {failed.map((i) => (
                    <tr key={i.id} className="muted"><td>{i.original_filename}</td><td colSpan={3}>Not included: {i.error_message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="actions actions--start">
            <button type="button" className="button" onClick={() => setBackToCrops(true)}>← Back to crops</button>
            <button type="button" className="button" onClick={() => setClearing(true)}>Start a new batch</button>
            <button type="button" className="button hs-link" onClick={() => setClearing(true)}>Clear photos from this browser</button>
          </div>
        </>
      )}
      {clearing && (
        <ConfirmModal
          title="Clear these photos?"
          confirmLabel="Clear photos"
          onConfirm={() => { setClearing(false); void clear(); }}
          onCancel={() => setClearing(false)}
        >
          <p>This removes the photos, crops and names from this browser. Download your ZIP first if you still need it.</p>
        </ConfirmModal>
      )}
    </div>
  );
}
