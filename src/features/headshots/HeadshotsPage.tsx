import { useEffect } from "react";
import { ExportScreen } from "./screens/ExportScreen";
import { ProcessingScreen } from "./screens/ProcessingScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { UploadScreen } from "./screens/UploadScreen";
import { useBatch } from "./state/BatchContext";

/** No sub-routes: the screen follows the batch's state. */
export function HeadshotsPage() {
  const { batch, backToCrops, storageFailed } = useBatch();
  const screen = !batch ? "upload"
    : batch.status === "PROCESSING" ? "processing"
    : batch.status === "READY" || batch.status === "FAILED" || backToCrops ? "review"
    : "export";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  return (
    <>
      {storageFailed && (
        <div className="note note--warn">Your work won't survive a page refresh in this browser.</div>
      )}
      {screen === "upload" && <UploadScreen />}
      {screen === "processing" && batch && <ProcessingScreen batch={batch} />}
      {screen === "review" && batch && <ReviewScreen batch={batch} />}
      {screen === "export" && batch && <ExportScreen batch={batch} />}
    </>
  );
}
