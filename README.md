# tui3

A terminal client for [T3 Code](https://github.com/pingdotgg/t3code). It connects to the T3 Code server you already run, shows every thread live, and lets you read, message, approve and stop them without the GUI.

Built with Bun and [OpenTUI](https://github.com/anomalyco/opentui) (React).

## Install

```sh
git clone --recurse-submodules <this repo> && cd tui3
bun install          # also links the pinned T3 Code packages into node_modules
bun link             # optional: puts `tui3` on your PATH
```

## Use

```sh
tui3                  # dashboard: threads on the left, the selected thread on the right
tui3 attach <thread>  # one thread, full screen (id, short id from `tui3 list`, or title text)
tui3 list [--json]    # print threads and exit
tui3 tmux [--watch]   # mirror active threads into a tmux session, one window each
```

Dashboard keys:

| Key | Action |
| --- | --- |
| `j`/`k`, arrows | move in the list, or scroll the thread |
| `enter`/`tab`, `esc` | switch between list and thread |
| `/` | filter threads by title or project |
| `i` | message the thread (queued after the current run) |
| `y` / `Y` / `n` | accept / accept for session / decline the pending approval |
| `S` | stop the thread |
| `r` | show full reasoning |
| `g` / `G` | top / bottom of the thread |
| `q`, `ctrl+c` | quit |

Threads are grouped into **Needs you** (waiting on an approval), **Running**, and **Recent**.

## How it connects

- It finds the local server from `~/.t3/userdata/server-runtime.json` (override with `TUI3_SERVER`).
- On first run it mints its own bearer session with `t3 auth session issue --label tui3`, scoped to `orchestration:read` and `orchestration:operate`, and stores it in `~/.config/tui3/credentials.json` (mode 600). Revoke it any time with `t3 auth session revoke`. For a remote server, pass a token in `TUI3_TOKEN`.
- It speaks T3 Code's own WebSocket RPC protocol, typed by upstream's `@t3tools/contracts`, and applies thread updates with upstream's own reducers. Both come from `vendor/t3code`, a submodule pinned to the server version this was built against (`v0.1.6-nightly.20261030.3917`).

## Updating for a newer T3 Code

The protocol packages are private and change without notice, so tui3 tracks a pinned upstream tag:

```sh
cd vendor/t3code && git fetch --depth 1 origin tag <tag> && git checkout <tag> && cd -
bun install && bun run typecheck && bun test
```

Type errors after a bump point at the protocol changes to adapt to.

## Not yet supported

Answering agent questions (`user_input` requests), starting new threads, attachments, diffs, and the integrated terminal. Use the T3 Code app for those.
