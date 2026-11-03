import { homedir } from "node:os";

/** A path with the home folder as `~`, whichever way the path's slashes lean. */
export function tildify(path: string, home: string = homedir()): string {
  return path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`) ? `~${path.slice(home.length)}` : path;
}

/** Whether this is a Windows path no folder can be relative to: `C:\x`, `C:/x` or `\\server\x`. */
export const isWindowsAbsolute = (path: string) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path);
