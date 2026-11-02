// Bundles t3tui into dist/. Running the TypeScript sources makes Bun compile and keep
// hundreds of vendored modules at startup, which costs over 100 MB of memory.
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
await rm(outdir, { recursive: true, force: true });

const builds = [
  join(root, "src/bin.ts"),
  // OpenTUI starts its syntax highlighter from parser.worker.js beside the code that loads it.
  join(root, "node_modules/@opentui/core/parser.worker.js"),
];
for (const entrypoint of builds) {
  // OpenTUI's native library comes from a package per platform, found in node_modules at run time.
  const result = await Bun.build({ entrypoints: [entrypoint], outdir, target: "bun", minify: true, external: ["@opentui/core-*"] });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}
