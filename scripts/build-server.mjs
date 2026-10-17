import { build } from "esbuild";

// One file for Node; npm packages stay in node_modules (the host runs npm install).
await build({
  entryPoints: ["server/src/index.ts"],
  outfile: "server-dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
