// Compiles t3tui into one executable per platform, with Bun's runtime and OpenTUI's native
// library inside, so users need neither Bun nor a checkout. Usage:
//   bun run compile [linux-x64 linux-arm64 darwin-x64 darwin-arm64]
// With no targets it builds for this machine. Binaries land in release/t3tui-<os>-<arch>.
// Cross-compiling needs every platform's OpenTUI package: bun install --os='*' --cpu='*'
import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"];
// Every native package OpenTUI might import. Each binary keeps only its own platform's.
const NATIVE = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "linux-x64-musl", "linux-arm64-musl", "win32-x64", "win32-arm64"].map((t) => `@opentui/core-${t}`);
/** Bun names Windows "windows"; npm and OpenTUI's packages call it "win32". */
const nativeOf = (target: string) => `@opentui/core-${target.replace(/^windows-/, "win32-")}`;

const root = join(import.meta.dir, "..");
const outdir = join(root, "release");
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push(`${process.platform}-${process.arch}`);
for (const target of targets) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}; expected one of ${TARGETS.join(", ")}`);
  if (!existsSync(join(root, "node_modules", nativeOf(target)))) {
    throw new Error(`${nativeOf(target)} isn't installed; run bun install --os='*' --cpu='*'`);
  }
}

await mkdir(outdir, { recursive: true });
for (const target of targets) {
  const outfile = join(outdir, `t3tui-${target}`);
  const external = NATIVE.filter((name) => name !== nativeOf(target)).flatMap((name) => ["--external", name]);
  // OpenTUI starts its syntax highlighter from parser.worker.js, so it's compiled in as a second entrypoint.
  await $`bun build --compile --minify --target=bun-${target} ${external} ${join(root, "src/bin.ts")} ${join(root, "node_modules/@opentui/core/parser.worker.js")} --outfile ${outfile}`.cwd(root);
}
