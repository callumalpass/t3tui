// `t3tui upgrade`: replaces a released binary with the latest release's.
import { chmod, rename, rm } from "node:fs/promises";
import { readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { version } from "../package.json" with { type: "json" };

export const VERSION = version;
const REPO = "callumalpass/t3tui";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_URL = `https://github.com/${REPO}/releases/download`;

/** Bun's embedded filesystem: `/$bunfs/…`, or `B:\~BUN\…` on Windows. */
export const isEmbeddedPath = (path: string) => path.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(path);

/** A compiled binary runs its code from Bun's embedded filesystem. */
export function isCompiled(): boolean {
  return isEmbeddedPath(import.meta.path);
}

/** The release asset for this machine, e.g. t3tui-linux-x64 or t3tui-windows-x64.exe. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string {
  return platform === "win32" ? `t3tui-windows-${arch}.exe` : `t3tui-${platform}-${arch}`;
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
  const latest = await fetch(LATEST_URL, { headers: { accept: "application/vnd.github+json" } });
  if (latest.status === 404) throw new Error("No t3tui release has been published yet.");
  if (!latest.ok) throw new Error(`Couldn't check for a new release (GitHub answered ${latest.status}).`);
  const tag = ((await latest.json()) as { tag_name: string }).tag_name;
  if (tag === `v${VERSION}`) {
    console.log(`t3tui ${VERSION} is the latest release.`);
    return;
  }
  const file = `${assetName()}.gz`;
  const base = `${DOWNLOAD_URL}/${tag}`;
  const [archive, sums] = await Promise.all([download(`${base}/${file}`), download(`${base}/SHA256SUMS`)]);
  const expected = checksumFor(new TextDecoder().decode(sums), file);
  if (!expected) throw new Error(`Release ${tag} has no ${file}.`);
  const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`The downloaded ${file} doesn't match its checksum; nothing was changed.`);

  await replaceBinary(realpathSync(process.execPath), Bun.gunzipSync(archive));
  console.log(`t3tui ${VERSION} → ${tag.replace(/^v/, "")}`);
}

/** Puts `binary` where `target` is, which may be the running program. */
export async function replaceBinary(target: string, binary: Uint8Array, platform: string = process.platform): Promise<void> {
  const temporary = `${target}.upgrade-${process.pid}`;
  try {
    await Bun.write(temporary, binary);
    if (platform === "win32") {
      // Windows won't let a running .exe be replaced, or deleted, but it can be moved aside.
      const aside = `${target}${OLD_SUFFIX}${process.pid}`;
      await rename(target, aside);
      await rename(temporary, target).catch(async (error) => {
        await rename(aside, target);
        throw error;
      });
    } else {
      // Renaming over the running binary is safe: the running process keeps the old file open.
      await chmod(temporary, 0o755);
      await rename(temporary, target);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw new Error(`Can't write ${target}. ${platform === "win32" ? "Rerun from an administrator terminal." : "Rerun with permission to replace it (e.g. sudo t3tui upgrade)."}`);
    throw error;
  }
}

const OLD_SUFFIX = ".old-";

/** Deletes what an upgrade moved aside on Windows; one another t3tui still runs stays for next time. */
export function removeOldBinaries(target: string = process.execPath): void {
  const folder = dirname(target);
  for (const name of readdirSync(folder)) {
    if (!name.startsWith(`${basename(target)}${OLD_SUFFIX}`)) continue;
    try {
      rmSync(join(folder, name));
    } catch {}
  }
}

async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download ${url} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
