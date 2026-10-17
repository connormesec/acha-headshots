/** The local number reader for photo sorting (replaces EasyOCR). Free: runs in the browser. */

import { calibrate, readNumbers } from "./ocr/reader";
import type { RGBAImage } from "./ocr/image";
import { OCR_MODELS, runOcr, session } from "./ort";

export interface OcrReading { number: number; confidence: number; region: string }

/** Load both models now (shows any download problem before a job starts). */
export const loadOcr = () => Promise.all([session(OCR_MODELS.det), session(OCR_MODELS.rec)]);

/** Back numbers usually land in the jersey crop; sleeve/shoulder numbers in the upper-body crop.
 * Never throws: an OCR failure is "no reading". */
export async function readJerseyNumbers(jersey: RGBAImage, upper: RGBAImage): Promise<OcrReading[]> {
  try {
    const readings = await readNumbers([{ region: "jersey", image: jersey }, { region: "upper_body", image: upper }], runOcr);
    return readings.map((r) => ({ ...r, confidence: calibrate(r.confidence) })).filter((r) => r.confidence > 0);
  } catch (e) {
    console.warn("number reader failed", e);
    return [];
  }
}
