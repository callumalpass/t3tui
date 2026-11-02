import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Scopes tui3 asks for: read and operate threads, read diffs, run git actions
 * (commit, push, open a PR), and stop a thread's local servers.
 */
export const TUI3_SCOPES = ["orchestration:read", "orchestration:operate", "filesystem:read", "source-control:write", "terminal:operate"] as const;

export interface ServerTarget {
  /** e.g. http://127.0.0.1:3773 */
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export interface StoredCredential {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly issuedAt: string;
  /** Absent on credentials from before scopes were recorded. */
  readonly scopes?: readonly string[];
}

const t3Home = () => process.env.T3CODE_HOME ?? join(homedir(), ".t3");
export const configDir = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "tui3");
const credentialPath = () => join(configDir(), "credentials.json");

/** Finds the local server from the runtime file T3 Code writes on startup. */
export async function resolveLocalServer(): Promise<ServerTarget> {
  const override = process.env.TUI3_SERVER;
  if (override) return targetFromHttp(override);
  const runtimePath = join(t3Home(), "userdata", "server-runtime.json");
  let runtime: { origin?: string; port?: number };
  try {
    runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  } catch {
    throw new Error(`No running T3 Code server found (${runtimePath} is missing). Start T3 Code, or set TUI3_SERVER.`);
  }
  const origin = runtime.origin ?? `http://127.0.0.1:${runtime.port ?? 3773}`;
  return targetFromHttp(origin);
}

function targetFromHttp(httpBaseUrl: string): ServerTarget {
  const url = new URL(httpBaseUrl);
  const ws = new URL(url);
  ws.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { httpBaseUrl: url.origin, wsBaseUrl: ws.origin };
}

export async function readCredential(target: ServerTarget): Promise<StoredCredential | undefined> {
  if (process.env.TUI3_TOKEN) {
    return { httpBaseUrl: target.httpBaseUrl, bearerToken: process.env.TUI3_TOKEN, issuedAt: "" };
  }
  try {
    const all: StoredCredential[] = JSON.parse(await readFile(credentialPath(), "utf8"));
    const stored = all.find((c) => c.httpBaseUrl === target.httpBaseUrl);
    // A credential from an older tui3 lacks newer scopes; issue a fresh one.
    return stored && TUI3_SCOPES.every((scope) => stored.scopes?.includes(scope)) ? stored : undefined;
  } catch {
    return undefined;
  }
}

async function writeCredential(credential: StoredCredential): Promise<void> {
  const path = credentialPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let all: StoredCredential[] = [];
  try {
    all = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  all = [...all.filter((c) => c.httpBaseUrl !== credential.httpBaseUrl), credential];
  await writeFile(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

/**
 * Issues a scoped bearer session through the local `t3` CLI, which can mint one
 * because it shares the server's data directory. Remote servers need TUI3_TOKEN.
 */
export async function issueLocalCredential(target: ServerTarget): Promise<StoredCredential> {
  const t3 = process.env.TUI3_T3_BIN ?? join(t3Home(), "bin", "t3");
  const args = ["auth", "session", "issue", "--label", "tui3", "--token-only"];
  for (const scope of TUI3_SCOPES) args.push("--scope", scope);
  const proc = Bun.spawn([t3, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const token = stdout.trim().split("\n").pop()?.trim();
  if (code !== 0 || !token) {
    throw new Error(`\`t3 auth session issue\` failed (exit ${code}): ${stderr.trim() || stdout.trim()}`);
  }
  const credential = { httpBaseUrl: target.httpBaseUrl, bearerToken: token, issuedAt: new Date().toISOString(), scopes: [...TUI3_SCOPES] };
  await writeCredential(credential);
  return credential;
}

export class UnauthorizedError extends Error {}

/** Exchanges the bearer token for a one-shot ticket and builds the socket URL. */
export async function resolveSocketUrl(
  target: ServerTarget,
  credential: StoredCredential,
  protocol: { param: string; version: number },
): Promise<string> {
  const response = await fetch(`${target.httpBaseUrl}/api/auth/websocket-ticket/rpc`, {
    method: "POST",
    headers: { authorization: `Bearer ${credential.bearerToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError(`T3 Code rejected tui3's token (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`WebSocket ticket request failed: ${response.status} ${await response.text()}`);
  }
  const { ticket } = (await response.json()) as { ticket: string };
  const url = new URL("/ws", target.wsBaseUrl);
  url.searchParams.set("wsTicket", ticket);
  url.searchParams.set(protocol.param, String(protocol.version));
  url.searchParams.set("clientSurface", "tui3");
  url.searchParams.set("connectionMethod", "direct");
  return url.toString();
}
