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

The message box is always at the bottom. tui3 has two modes: **typing**, where keys go to the message box, and **navigation**, where single keys act. `esc` switches to navigation; `i`, `enter` or `tab` switch back. Drafts are kept per thread.

Any mode:

| Key | Action |
| --- | --- |
| `ctrl+k` | command palette: every action below, plus thread search |
| `ctrl+j` | attach to the thread's terminal (see below) |
| `ctrl+n` / `ctrl+p` (or `alt+↓`/`alt+↑`) | next / previous thread |
| `pgup`/`pgdn`, `ctrl+u`/`ctrl+d` | scroll the conversation |
| `ctrl+c` | quit |

Typing: `enter` sends. While the agent is running, `enter` steers it (the message reaches it mid-run) and `alt+enter` queues the message for after the run, as in T3 Code. With an approval pending, a typed message declines it with your feedback. `shift+enter` adds a newline (it needs a terminal with the kitty keyboard protocol); so does ending the line with `\` and pressing `enter`. The box grows up to 8 lines. `ctrl+g` opens the message in `$VISUAL` or `$EDITOR` (falling back to `vi`); save and quit to bring it back.

As in T3 Code's message box, typing a trigger opens a list of suggestions above the box:

| Trigger | Suggests | Inserts |
| --- | --- | --- |
| `/` | `/model`, then the provider's commands (only at the start of the message) and skills | `/command`, or `$skill` for a skill; `/model` opens the model picker |
| `$` | the provider's skills | `$skill` |
| `@` | threads, then files and folders in the thread's worktree or project | a markdown link to the file, or a link to the thread (sent along with the message, as T3 does) |

`↑`/`↓` or `ctrl+n`/`ctrl+p` move, `tab` or `enter` chooses, a click chooses, and `esc` closes the list. Links show as raw markdown in the box; T3 shows them as chips. `#` (pull requests) isn't supported yet.

Navigation:

| Key | Action |
| --- | --- |
| `j`/`k`, arrows | next / previous thread (scroll, in `attach`) |
| `c` | new thread (see below) |
| `a` | attach a file to the next message (see below) |
| `.` | thread actions (see below); a right-click on a thread opens them too |
| `m` | model, options (reasoning, fast mode…) and access mode |
| `y` / `Y` / `n` | approve / always allow this session / decline the pending approval |
| `1`–`9` | pick an option when the agent asks a question (also in an empty message box) |
| `x` | dismiss the agent's question |
| `e` | expand all folded turns and work groups |
| `o` | load earlier turns |
| `d` | show or hide thread details |
| `l` / `→` | move into the details panel: `j`/`k` choose, `enter` opens, `t` turns an automation on or off, `esc` comes back |
| `u` | go to the parent thread (from a fork or subagent) |
| `:` | command palette |
| `z` | show the Settled and Snoozed sections |
| `/` | filter threads by title or project (the box opens at the top of the thread list) |
| `S` | stop the thread |
| `g` / `G` | top / bottom of the conversation |
| `esc` / `q` | close the diff or cancel a new thread; otherwise `q` quits |

The layout follows T3 Code's web app, and much of it uses the web app's own code (vendored from upstream):

- **Sidebar:** the same sections (Pinned, Active, Working, then Snoozed and Settled folded to a count) and the same status words: `Working 2m`, `Waiting`, `Approval`, `Input`, `Request`, `Limited`, `Failed`, `Done`. Threads that need you are bold.
- **Conversation:** built by the web app's timeline logic. Each finished turn's work folds into one line (`Worked for 3m 12s`), your messages are right-aligned, and a running turn shows its live step and `Working for 12s`.
- **Thread details:** a column beside the conversation with the workspace, model and mode, the branch with ahead/behind and its pull request, uncommitted changes per file, lineage (forks and subagents), background work and the goal. It opens by itself on terminals 160 columns or wider; on narrow ones `d` shows it in place of the conversation.
- **Diffs:** pick `View diff` or a file under Changes to see uncommitted changes as unified diffs in place of the conversation. `j`/`k` scroll, `esc` closes.
- **Git:** the branch section offers the web app's quick action (`Commit & push`, `Push`, `Create PR`…) and its menu. Every action asks first, says when you are on the default branch, and takes an optional commit message (blank lets T3 write one). Progress shows on the bottom line.
- **Servers and automations:** local dev servers the thread started (stop one from the panel) and T3's scheduled tasks with their schedule and next run (run now, or turn on and off). Automations are made and changed from the palette: `New automation` and `Edit automation: …` open the web form's fields in `$EDITOR` (title, schedule, project, workspace, model, mode, prompt); save and quit to save. `Delete automation: …` asks first. Webhook signatures and filters are kept as they are; change those in the app.
- **Subagents:** subagent work in the conversation and the lineage rows in details are links; `enter` or a click opens the child thread, and `u` goes back. Idle subagents, which the thread list leaves out, are fetched from the server when you open one (on servers that serve them).
- **Command palette:** `ctrl+k`, as in the web app. It searches commands and threads with T3's own scoring; start with `>` for commands only.
- **Mouse:** click a thread to open it, a collapsed section to unfold it, a details row to run it, the message box to type, or a palette row.
- Threads open scrolled to the bottom.
- **Read state:** opening a thread marks it read after a moment, as the web app does. Set `TUI3_NO_VISIT=1` to turn that off.

## Thread actions

`.`, `Thread actions…` in the palette, or a right-click on a thread in the list opens T3 Code's thread menu, built by the web app's own code:

- New thread on the thread's branch (in its worktree, if it has one)
- Pin or unpin, settle or un-settle, snooze (T3's presets or a custom time) or wake
- Rename, regenerate the title, mark unread
- Auto-settle on or off for the thread (on servers that support turning it off)
- Copy the workspace path, branch, thread link or thread ID
- Archive or delete

Submenus open as their own list, and typing finds their items from the top (`thread id` finds `Copy › Thread ID`). A custom snooze takes a duration (`45m`, `3h`, `2d`, `1w`) or a time of day (`17:30`). Delete asks first, as the app does by default; it doesn't offer to remove the thread's worktree, which the app does. Copying goes through the terminal (OSC 52, so it works over SSH), and through `wl-copy`, `xclip` or `pbcopy` on a local desktop. The app's project settings, guest sharing and find-in-thread aren't here.

## New threads

`c` (or `New thread` in the palette) opens a draft in the current thread's project, with the defaults T3 Code would use: the server's default model and mode for new threads, and the project folder or a new worktree as the project settings say. In the draft, `p` picks the project, `m` the model and mode, and `w` switches between the project folder and a new worktree off the default branch. Write the first message and send it: that starts the thread, which T3 then titles. `esc` cancels.

## Attachments

`a` in navigation (or `Attach file…` in the palette) prompts for a path: `~` expands, and a relative path is taken from the thread's worktree or project folder. `Paste image from clipboard` in the palette takes a clipboard image instead (`wl-paste`, `xclip`, or `pngpaste` on macOS). Files upload at once, as in the web composer, and their names show above the message box until the next message sends them; `Remove attachment: …` in the palette takes one back and deletes the unsent upload. The web composer's limits apply: GIF, JPEG, PNG and WebP images up to 10 MB each and 80 MB in all, other files up to the server's limit (50 MB at most), 100 attachments per message. A message can be attachments alone.

## Model, options and mode

`m` (or a click on the model under the message box) opens a picker with the access mode, the model's options as the server describes them (reasoning effort, fast mode and whatever else the provider offers), and every model from the providers that are enabled and available. As in the web app:

- A new model or option applies from the next message you send; the line under the box shows `· next message` until then.
- The access mode changes at once.
- Once a thread has run, it stays on its provider; you can still change models within it.

## Terminals

`ctrl+j` attaches to the thread's terminal on the T3 server, the same one the app's terminal drawer shows. If the thread has none, it starts one in the thread's worktree or project folder; with several, you pick one or start another. tui3 hands the whole screen to the terminal; `ctrl+j` or `ctrl+]` comes back. The terminal keeps running after you detach. The terminal's size is shared, so attaching resizes it for anyone else watching.

## Alerts

tui3 alerts when a thread you aren't watching finishes or needs you (approval, input, a request, a failure or a usage limit), using T3 Code's own rules for when to alert. Subagents don't alert. Depending on `notificationMode`:

- **Bell:** the terminal bell.
- **Desktop notifications:** sent through the terminal (OSC 9, or OSC 99 in kitty), only when the terminal window isn't focused. Under tmux they need `set -g allow-passthrough on`.

While the terminal is focused, alerts for other threads also show on the bottom line (`inAppNotificationsEnabled`).

## Settings

Open them from the command palette (`Settings`). `j`/`k` move, `enter` or a click changes one, and changes save to `~/.config/tui3/config.json`:

| Setting | Choices | Default |
| --- | --- | --- |
| `followUpBehavior` | `steer` or `queue`: what `enter` does while the agent runs (`alt+enter` does the other) | `steer` |
| `sendShortcut` | `enter`, or `ctrl-enter` (then `enter` adds a line; needs the kitty keyboard protocol, and `alt+enter` also sends) | `enter` |
| `timestampFormat` | `locale`, `12-hour`, `24-hour` | `locale` |
| `diffIgnoreWhitespace` | `true`, `false` | `true` |
| `notificationMode` | `off`, `sound` (bell), `notifications` (desktop), `notifications-and-sound` | `sound` |
| `inAppNotificationsEnabled` | `true`, `false` | `true` |

These use the web app's names, and its defaults except for the two alert settings, which the web app leaves off. The web app keeps them in each browser, so tui3 can't read yours and keeps its own. The same view shows the server's settings that matter here (model and mode for new threads, auto-settle, rate-limited threads), read-only: change those in the app. Below them is usage: each provider's limit windows as room left, its banked reset credits, and the last 30 days' cost and tokens. When a window is 90% used or more, the top line says so. Spend a banked credit from the palette (`Use reset credit: …`); it asks first, as the app does.

Long threads load as a bounded window of recent turns; press `o` for older ones. If the connection drops, tui3 reconnects with backoff and resubscribes.

## How it connects

- It finds the local server from `~/.t3/userdata/server-runtime.json` (override with `TUI3_SERVER`).
- On first run it mints its own bearer session with `t3 auth session issue --label tui3`, scoped to `orchestration:read`, `orchestration:operate` (attachments and automations ride on it), `filesystem:read` (diffs), `source-control:write` (git actions), `terminal:read` and `terminal:operate` (terminals, stopping servers), `diagnostics:read` (usage totals) and `providers:manage` (reset credits), and stores it in `~/.config/tui3/credentials.json` (mode 600). Revoke it any time with `t3 auth session revoke`. A stored credential missing any of these scopes is replaced with a new one. For a remote server, pass a token in `TUI3_TOKEN`.
- It speaks T3 Code's own WebSocket RPC protocol, typed by upstream's `@t3tools/contracts`, and applies thread updates with upstream's own reducers. Both come from `vendor/t3code`, a submodule pinned to the server version this was built against (`v0.1.6-nightly.20261030.3917`).

Set `TUI3_DEBUG=/path/to/log` to log thread subscriptions and snapshots.

## Updating for a newer T3 Code

The protocol packages are private and change without notice, so tui3 tracks a pinned upstream tag:

```sh
cd vendor/t3code && git fetch --depth 1 origin tag <tag> && git checkout <tag> && cd -
bun install && bun run typecheck && bun test
```

Type errors after a bump point at the protocol changes to adapt to.

## Not yet supported

Editing queued messages, `#` pull request mentions, plan follow-ups, forking threads, and reviewing or commenting on diffs. Use the T3 Code app for those.
