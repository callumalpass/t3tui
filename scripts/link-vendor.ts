// Exposes the pinned T3 Code workspace packages under node_modules/@t3tools so
// their package export maps resolve. They are TypeScript sources Bun runs as-is.
import { lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "vendor/t3code/packages");
const scopeDir = join(root, "node_modules/@t3tools");
await mkdir(scopeDir, { recursive: true });
for (const name of await readdir(packagesDir)) {
  const link = join(scopeDir, name);
  await lstat(link).then(() => rm(link, { recursive: true, force: true }), () => {});
  await symlink(relative(scopeDir, join(packagesDir, name)), link, "dir");
}
