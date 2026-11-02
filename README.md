# tui3

**A TUI for a GUI for TUIs.**

Claude Code and Codex run in a terminal. [T3 Code](https://github.com/pingdotgg/t3code) gives them a proper app, with your threads, worktrees, diffs and approvals in one window, which is a lot nicer than keeping track of a dozen terminal tabs. tui3 takes that app and puts it back in a terminal.

It works anywhere you can get a shell, so you can check on a run over SSH from a laptop or your phone, or from a server you were already logged into. `tui3 tmux --watch` mirrors each active thread into its own tmux window, which you can detach from and come back to later. Everything is on the keyboard (`j`/`k` between threads, `y` to approve, `D` for the diff, `ctrl+k` for the rest), and `tui3 list --json` gives scripts something to read. Since it talks to the same server as the app, you can start a run in one and carry on in the other without anything needing to sync.

tui3 doesn't have to do much. T3 Code's server runs the agents and keeps track of sessions, worktrees, checkpoints, approvals, terminals and pull requests. tui3 connects to the server you already have running, speaks its WebSocket protocol, and applies updates with upstream's own types and reducers, so mostly it draws what T3 Code already knows and sends back what you type. That's why it was quick to build, and why it tends to stay in step with the app. Credit for the parts that work goes to T3 Code; anything that looks wrong is probably tui3's fault.

Built with Bun and [OpenTUI](https://github.com/anomalyco/opentui) (React). tui3 is an unofficial project, not made by or affiliated with the T3 Code team.

## Install

You need [Bun](https://bun.sh) and a T3 Code server running on the same machine (or a token for a remote one; see [How it connects](#how-it-connects)).

```sh
git clone --recurse-submodules https://github.com/callumalpass/tui3.git && cd tui3
bun install          # also links the pinned T3 Code packages into node_modules and builds dist/
bun link             # optional: puts `tui3` on your PATH
```

After pulling changes, run `bun run build` (or `bun install`) to rebuild.

## Use

```sh
tui3                  # dashboard: threads on the left, the selected thread on the right
tui3 attach <thread>  # one thread, full screen (id, short id from `tui3 list`, or title text)
tui3 list [--json]    # print threads and exit
tui3 tmux [--watch]   # mirror active threads into a tmux session, one window each
```

The message box is always at the bottom. tui3 has two modes: **typing**, where keys go to the message box, and **navigation**, where single keys act. `esc` switches to navigation; `i`, `enter` or `tab` switch back.

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

tui3 finds the local T3 Code server from `~/.t3/userdata/server-runtime.json` (override with `TUI3_SERVER`). On first run it issues itself a session with `t3 auth session issue --label tui3`, scoped to what it needs, and stores it in `~/.config/tui3/credentials.json`. Revoke it any time with `t3 auth session revoke`. For a remote server, pass a token in `TUI3_TOKEN`.

The scopes, the protocol and how to update for a newer T3 Code are in [docs/development.md](docs/development.md).

## Not yet supported

Plan follow-ups, forking threads, reviewing or commenting on diffs, rewinding messages with attachments, project settings and guest sharing. Use the T3 Code app for those.

## Licence

[MIT](LICENSE). T3 Code, pulled in as a submodule under `vendor/t3code`, is also MIT.
