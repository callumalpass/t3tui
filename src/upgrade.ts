// `t3tui upgrade`: replaces a released binary with the latest release's.
import { chmod, rename, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";

import { version } from "../package.json" with { type: "json" };

export const VERSION = version;
const REPO = "callumalpass/t3tui";

/** A compiled binary runs its code from Bun's embedded filesystem. */
export function isCompiled(): boolean {
  return import.meta.path.startsWith("/$bunfs/");
}

/** The release asset for this machine, e.g. t3tui-linux-x64. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string {
  return `t3tui-${platform}-${arch}`;
}

/** Finds an asset's hash in a sha256sum listing. */
export function checksumFor(sums: string, file: string): string | undefined {
  for (const line of sums.split("\n")) {
    const [hash, name] = line.trim().split(/\s+\*?/);
    if (name === file) return hash;
  }
  return undefined;
}

export async function upgrade(): Promise<void> {
  if (!isCompiled()) {
    console.log("t3tui is running from source. Update it with: git pull --recurse-submodules && bun install");
    return;
  }
  const latest = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
  if (latest.status === 404) throw new Error("No t3tui release has been published yet.");
  if (!latest.ok) throw new Error(`Couldn't check for a new release (GitHub answered ${latest.status}).`);
  const tag = ((await latest.json()) as { tag_name: string }).tag_name;
  if (tag === `v${VERSION}`) {
    console.log(`t3tui ${VERSION} is the latest release.`);
    return;
  }
  const file = `${assetName()}.gz`;
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  const [archive, sums] = await Promise.all([download(`${base}/${file}`), download(`${base}/SHA256SUMS`)]);
  const expected = checksumFor(new TextDecoder().decode(sums), file);
  if (!expected) throw new Error(`Release ${tag} has no ${file}.`);
  const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`The downloaded ${file} doesn't match its checksum; nothing was changed.`);

  // Renaming over the running binary is safe: the running process keeps the old file open.
  const target = realpathSync(process.execPath);
  const temporary = `${target}.upgrade-${process.pid}`;
  try {
    await Bun.write(temporary, Bun.gunzipSync(archive));
    await chmod(temporary, 0o755);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw new Error(`Can't write ${target}. Rerun with permission to replace it (e.g. sudo t3tui upgrade).`);
    throw error;
  }
  console.log(`t3tui ${VERSION} → ${tag.replace(/^v/, "")}`);
}

async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download ${url} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
