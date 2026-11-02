# t3tui

**A TUI for a GUI for TUIs.**

Claude Code and Codex run in a terminal. [T3 Code](https://github.com/pingdotgg/t3code) gives them a proper app, with your threads, worktrees, diffs and approvals in one window, which is a lot nicer than keeping track of a dozen terminal tabs. t3tui takes that app and puts it back in a terminal.

It works anywhere you can get a shell, so you can check on a run over SSH from a laptop or your phone, or from a server you were already logged into. `t3tui tmux --watch` mirrors each active thread into its own tmux window, which you can detach from and come back to later. Everything is on the keyboard (`j`/`k` between threads, `y` to approve, `D` for the diff, `ctrl+k` for the rest), and `t3tui list --json` gives scripts something to read. Since it talks to the same server as the app, you can start a run in one and carry on in the other without anything needing to sync.

t3tui doesn't have to do much. T3 Code's server runs the agents and keeps track of sessions, worktrees, checkpoints, approvals, terminals and pull requests. t3tui connects to the server you already have running, speaks its WebSocket protocol, and applies updates with upstream's own types and reducers, so mostly it draws what T3 Code already knows and sends back what you type. That's why it was quick to build, and why it tends to stay in step with the app. Credit for the parts that work goes to T3 Code; anything that looks wrong is probably t3tui's fault.

Built with Bun and [OpenTUI](https://github.com/anomalyco/opentui) (React). t3tui is an unofficial project, not made by or affiliated with the T3 Code team.

## Install

You need a T3 Code server running on the same machine (or a token for a remote one; see [How it connects](#how-it-connects)). On Linux or macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/callumalpass/t3tui/main/install.sh | sh
```

That puts a single `t3tui` binary in `~/.local/bin` (set `T3TUI_INSTALL_DIR` to change it). It needs nothing else installed, not even Bun. `t3tui upgrade` replaces it with the latest release, and `t3tui version` says which you have. Each release notes the T3 Code version it was built against.

### Build from source

On other systems (Windows, or Linux with musl), or to run unreleased changes, you need [Bun](https://bun.sh) 1.3.14 or later:

```sh
git clone --recurse-submodules https://github.com/callumalpass/t3tui.git && cd t3tui
bun install          # also links the pinned T3 Code packages into node_modules and builds dist/
bun link             # optional: puts `t3tui` on your PATH
```

After pulling changes, run `bun run build` (or `bun install`) to rebuild.

## Use

```sh
t3tui                 # dashboard: threads on the left, the selected thread on the right
t3tui attach <thread> # one thread, full screen (id, short id from `t3tui list`, or title text)
t3tui list [--json]   # print threads and exit
t3tui tmux [--watch]  # mirror active threads into a tmux session, one window each
```

The message box is always at the bottom. t3tui has two modes: **typing**, where keys go to the message box, and **navigation**, where single keys act. `esc` switches to navigation; `i`, `enter` or `tab` switch back.

The keys you'll use most:

| Key | Action |
| --- | --- |
| `ctrl+k` | command palette: every action, with its key, plus thread search |
| `ctrl+n` / `ctrl+p` | next / previous thread (`j`/`k` in navigation) |
| `enter` | send; while the agent runs, steer it mid-run |
| `alt+enter` | queue the message for after the run |
| `y` / `Y` / `n` | approve / always allow this session / decline |
| `S` | stop the thread |
| `D` | view the latest turn's changes |
| `P` | view the thread's pull request |
| `c` | new thread |
| `m` | model, reasoning and access mode |
| `.` | thread actions: pin, snooze, rename, archive… |
| `ctrl+j` | attach to the thread's terminal on the server |
| `ctrl+c` | quit |

In the message box, `/`, `$`, `@` and `#` suggest commands, skills, files and threads, and pull requests. Most things also work with the mouse.

See [docs/reference.md](docs/reference.md) for every key, the message box, diffs, git, terminals, worktrees, alerts and settings.

## How it connects

t3tui finds the local T3 Code server from `~/.t3/userdata/server-runtime.json` (override with `T3TUI_SERVER`). On first run it issues itself a session with `t3 auth session issue --label t3tui`, scoped to what it needs, and stores it in `~/.config/t3tui/credentials.json`. Revoke it any time with `t3 auth session revoke`. For a remote server, pass a token in `T3TUI_TOKEN`.

The scopes, the protocol and how to update for a newer T3 Code are in [docs/development.md](docs/development.md).

## Not yet supported

Plan follow-ups, forking threads, reviewing or commenting on diffs, rewinding messages with attachments, project settings and guest sharing. Use the T3 Code app for those.

## Licence

[MIT](LICENSE). T3 Code, pulled in as a submodule under `vendor/t3code`, is also MIT.
