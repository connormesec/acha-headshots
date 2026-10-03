import { Stepper } from "../components/headshots/Stepper";
import { Working } from "../components/headshots/Working";
import { ErrorNote } from "../components/ui";
import type { Batch } from "../state/types";

export function ProcessingScreen({ batch }: { batch: Batch }) {
  return (
    <div className="hs-flow">
      <Stepper current={1} />
      <div className="page-head"><div><p className="eyebrow">Step 2 of 3</p><h1>Finding faces and cropping</h1></div></div>
      {batch.error_message ? (
        <section className="panel">
          <ErrorNote>{batch.error_message}</ErrorNote>
          <div className="actions actions--start">
            <button type="button" className="button button--primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </section>
      ) : (
        <Working
          label="Finding faces"
          done={batch.processed}
          total={batch.items.length}
          hint="Keep this tab open. Your progress is saved in this browser."
        />
      )}
    </div>
  );
}
