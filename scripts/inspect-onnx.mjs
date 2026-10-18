// Prints a model's inputs and outputs: node scripts/inspect-onnx.mjs <model.onnx>
import * as ort from "onnxruntime-node";
const s = await ort.InferenceSession.create(process.argv[2]);
console.log(JSON.stringify({ inputs: s.inputMetadata, outputs: s.outputMetadata }, null, 1));
