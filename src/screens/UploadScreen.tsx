import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Stepper } from "../components/headshots/Stepper";
import { UploadChecklist } from "../components/headshots/UploadChecklist";
import { ErrorNote } from "../components/ui";
import { MAX_PHOTOS } from "../lib/constants";
import { loadDetectors } from "../lib/detect";
import { classify, defaultName, filesFromDrop, formatSize, type Picked } from "../lib/ingest";
import { PHOTO_EXTENSIONS } from "../lib/names";
import { DETECTOR_ERROR, useBatch } from "../state/BatchContext";

export function UploadScreen() {
  const { start, saved, resume, clear } = useBatch();
  const [picked, setPicked] = useState<Picked>();
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [finder, setFinder] = useState<"loading" | "ready" | "failed">("loading");
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const reading = progress !== undefined;

  // Warm up the face finder while the user picks photos.
  useEffect(() => {
    let live = true;
    loadDetectors().then(() => live && setFinder("ready"), () => live && setFinder("failed"));
    return () => { live = false; };
  }, []);

  const choose = (files: File[]) => {
    setError(undefined);
    const result = classify(files);
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setPicked(result);
    const suggested = defaultName(files, result);
    if (suggested && !name) setName(suggested);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!reading) choose(await filesFromDrop(e));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setError(undefined);
    setProgress(0);
    try {
      await start(picked, name, setProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(undefined);
    }
  };

  const count = picked?.kind === "photos" ? picked.files.length : undefined;

  return (
    <>
      <section className="hs-hero">
        <div>
          <p className="eyebrow">Headshots for ACHA</p>
          <h1>Get your roster headshots ACHA-ready</h1>
          <p className="hs-hero__lead">
            Add your players' photos. We crop every one to <b>1000 × 1500</b> and shrink it <b>under 2 MB</b>,
            ready for ACHA. All you do is check the results.
          </p>
          <p className="hs-expiry">Your photos never leave your device. Everything happens in your browser.</p>
        </div>
        <ol className="hs-hero__steps">
          <li><b>Add photos</b><span>Drop in a folder, some photos, or a ZIP.</span></li>
          <li><b>Check crops</b><span>Fix any we flag, and name the files.</span></li>
          <li><b>Download</b><span>One ZIP, every photo ready to upload.</span></li>
        </ol>
      </section>

      {saved && (
        <section className="panel hs-resume">
          <h2 className="section-title">Continue your batch "{saved.name}" ({saved.count} {saved.count === 1 ? "photo" : "photos"})</h2>
          <p className="muted">Your last batch is still saved in this browser.</p>
          <div className="actions actions--start">
            <button type="button" className="button button--primary" onClick={() => void resume()}>Continue</button>
            <button type="button" className="button" onClick={() => void clear()}>Start over</button>
          </div>
        </section>
      )}

      <form className="hs-flow" onSubmit={submit}>
        <Stepper current={0} />
        <div className="page-head">
          <div>
            <p className="eyebrow">Step 1 of 3</p>
            <h1>Add your players' photos</h1>
          </div>
        </div>

        <UploadChecklist />

        <section className="panel">
          <h2 className="section-title">Choose your photos</h2>
          <div
            className={`dropzone ${dragging ? "is-dragging" : ""} ${picked ? "has-file" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={filesInput} type="file" multiple hidden accept={[...PHOTO_EXTENSIONS, ".zip", "image/*"].join(",")}
              data-testid="files-input"
              onChange={(e) => { choose(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            <input ref={(el) => { folderInput.current = el; el?.setAttribute("webkitdirectory", ""); }} type="file" hidden
              onChange={(e) => { choose(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

            {!picked && (
              <>
                <strong>Drag a folder, photos, or a ZIP here</strong>
                <span>Up to {MAX_PHOTOS} photos per batch</span>
              </>
            )}
            {picked?.kind === "zip" && (
              <>
                <strong className="dropzone__file">{picked.file.name}</strong>
                <span>ZIP file · {formatSize(picked.file.size)}</span>
              </>
            )}
            {picked?.kind === "photos" && (
              <>
                <strong>{count} {count === 1 ? "photo" : "photos"} ready</strong>
                <span>{formatSize(picked.files.reduce((n, f) => n + f.size, 0))} in total</span>
              </>
            )}
            <div className="dropzone__buttons">
              <button type="button" className="button button--small" onClick={() => filesInput.current?.click()} disabled={reading}>
                {picked ? "Choose different photos" : "Choose photos or a ZIP"}
              </button>
              <button type="button" className="button button--small" onClick={() => folderInput.current?.click()} disabled={reading}>
                Choose a folder
              </button>
            </div>
          </div>

          {picked?.kind === "photos" && picked.skipped.length > 0 && (
            <div className="note note--warn">
              <b>{picked.skipped.length} {picked.skipped.length === 1 ? "file" : "files"} will be skipped:</b>{" "}
              {picked.skipped.slice(0, 6).map((s) => `${s.name} (${s.reason})`).join(", ")}
              {picked.skipped.length > 6 && ` and ${picked.skipped.length - 6} more`}
            </div>
          )}
          {picked?.kind === "photos" && (
            <details className="hs-details">
              <summary>See the {count} photos</summary>
              <ul className="hs-filelist">{picked.files.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
            </details>
          )}

          <details className="hs-details">
            <summary>How do I make a ZIP? (You don't need one: choosing the folder works too.)</summary>
            <ul>
              <li><b>Windows:</b> right-click the folder, then <i>Send to → Compressed (zipped) folder</i>.</li>
              <li><b>Mac:</b> right-click the folder, then <i>Compress</i>.</li>
            </ul>
          </details>

          <p className="hs-privacy">
            🔒 <b>Your photos never leave your device.</b> Everything happens in your browser. Nothing is uploaded.
          </p>

          <label className="field hs-name">
            <span className="field__label">Name this batch <span className="muted">(optional)</span></span>
            <input className="search" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 MSU roster" maxLength={200} disabled={reading} />
          </label>

          {reading && (
            <div className="meter" aria-label="Reading progress">
              <span className="meter__fill is-live" style={{ width: `${Math.max(4, Math.round((progress ?? 0) * 100))}%` }} />
              <span className="meter__label">Reading photos…</span>
            </div>
          )}
          {finder === "loading" && picked && <p className="muted small">Getting the face finder ready…</p>}
          {finder === "failed" && <ErrorNote>{DETECTOR_ERROR}</ErrorNote>}
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="actions">
            <button className="button button--primary button--big" type="submit" disabled={!picked || reading || finder === "failed"}>
              {reading ? "Reading photos…" : "Crop my photos →"}
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
