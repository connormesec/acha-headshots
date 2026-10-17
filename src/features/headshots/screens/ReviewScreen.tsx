import { useState } from "react";
import { CropEditor } from "../components/CropEditor";
import { HeadshotCard } from "../components/HeadshotCard";
import { ConfirmModal } from "../../../components/Modal";
import { SkippedList } from "../components/SkippedList";
import { Stepper } from "../../../components/Stepper";
import { ErrorNote, plural } from "../../../components/ui";
import { useBatch } from "../state/BatchContext";
import { summary } from "../state/ops";
import type { Batch, Headshot, HeadshotPatch } from "../state/types";

export function ReviewScreen({ batch }: { batch: Batch }) {
  const { update, makeFiles, clear, setBackToCrops } = useBatch();
  const [editing, setEditing] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  if (batch.status === "FAILED") {
    return (
      <div className="hs-flow">
        <Stepper current={0} />
        <section className="panel">
          <h1>We couldn't process these photos</h1>
          <ErrorNote>{batch.error_message ?? "Something went wrong."}</ErrorNote>
          {batch.skipped.length > 0 && <SkippedList batch={batch} open />}
          <div className="actions">
            <button type="button" className="button button--primary" onClick={() => void clear()}>Try again with different files</button>
          </div>
        </section>
      </div>
    );
  }

  const patch = (item: Headshot, body: HeadshotPatch) => {
    setActionError(undefined);
    try {
      update(item.id, body);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };
  const rename = async (item: Headshot, name: string) => {
    update(item.id, { output_name: name }); // errors show under the field
  };
  const compress = () => {
    setConfirming(false);
    setActionError(undefined);
    void makeFiles();
  };

  const s = summary(batch);
  const ready = batch.items.filter((i) => i.status === "READY");
  const failed = batch.items.filter((i) => i.status === "FAILED");
  const look = ready.filter((i) => i.needs_look);
  const good = ready.filter((i) => i.included && !i.needs_look);
  const out = ready.filter((i) => !i.included);
  const editingItem = batch.items.find((i) => i.id === editing);

  const stale = batch.status === "READY" && ready.some((i) => i.output_bytes != null);
  const firstGeneric = () =>
    document.querySelector<HTMLInputElement>(
      `[data-item-id="${ready.find((i) => i.included && i.flags.includes("generic_name"))?.id}"] input[data-name-field]`,
    );
  const card = (item: Headshot) => (
    <div key={item.id} data-item-id={item.id}>
      <HeadshotCard
        item={item}
        onEdit={() => setEditing(item.id)}
        onApprove={() => patch(item, { approved: true })}
        onInclude={(included) => patch(item, { included })}
        onRename={(name) => rename(item, name)}
      />
    </div>
  );
  const goodCount = ready.length - look.length - out.length;

  return (
    <div className="hs-flow hs-flow--wide">
      <Stepper
        current={1}
        onSelect={(st) => st === 2 && setBackToCrops(false)}
        canSelect={(st) => st === 2 && batch.status === "COMPRESSED"}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">Step 2 of 3 · {batch.name}</p>
          <h1>
            {look.length === 0
              ? `All ${plural(goodCount, "photo")} look good`
              : `${plural(goodCount, "photo")} look${goodCount === 1 ? "s" : ""} great. ${look.length} need${look.length === 1 ? "s" : ""} a quick look.`}
          </h1>
        </div>
      </div>

      <p className="hs-expiry">Your photos never leave your device. Everything happens in your browser.</p>
      {(failed.length > 0 || batch.skipped.length > 0) && <SkippedList batch={batch} />}
      {stale && (
        <div className="note note--warn">You've made changes since your last download. Make new files when you're done.</div>
      )}
      {batch.error_message && <div className="note note--warn">{batch.error_message}</div>}
      {s.generic_names > 0 && (
        <div className="hs-nudge">
          <span>
            <b>{plural(s.generic_names, "photo")} still {s.generic_names === 1 ? "has" : "have"} a camera name</b> like IMG_1234.
            Add player names so they're easy to find when you upload to ACHA.
          </span>
          <button type="button" className="button button--small" onClick={() => firstGeneric()?.focus()}>Name photos</button>
        </div>
      )}
      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      {look.length > 0 && (
        <section>
          <h2 className="section-title c-review">Needs a look ({look.length})</h2>
          <div className="hs-grid">{look.map(card)}</div>
        </section>
      )}
      {good.length > 0 && (
        <section>
          <h2 className="section-title">{look.length ? `Looks great (${good.length})` : `Your photos (${good.length})`}</h2>
          <p className="muted small hs-tip">Click a photo to adjust its crop. Type a name under each one. Press Enter to jump to the next.</p>
          <div className="hs-grid">{good.map(card)}</div>
        </section>
      )}
      {out.length > 0 && (
        <section>
          <h2 className="section-title">Left out ({out.length})</h2>
          <div className="hs-grid">{out.map(card)}</div>
        </section>
      )}

      <div className="pick-bar hs-bar">
        <span className="hs-bar__status">
          {look.length > 0 ? <><b className="c-review">{look.length}</b> left to check</> : <>Everything checked <span className="c-good">✓</span></>}
          {out.length > 0 && <span className="muted"> · {out.length} left out</span>}
        </span>
        <button type="button" className="button button--primary button--big" disabled={!s.to_compress}
          onClick={() => (look.length ? setConfirming(true) : compress())}>
          Looks good — make ACHA files →
        </button>
      </div>

      {confirming && (
        <ConfirmModal
          title="Some photos still need a look"
          confirmLabel="Make files anyway"
          cancelLabel="Check them first"
          onConfirm={compress}
          onCancel={() => setConfirming(false)}
        >
          <p>{plural(look.length, "photo")} still {look.length === 1 ? "needs" : "need"} a look. Their crops may be wrong. Continue anyway?</p>
        </ConfirmModal>
      )}
      {editingItem && <CropEditor item={editingItem} onClose={() => setEditing(undefined)} onChanged={() => {}} />}
    </div>
  );
}
