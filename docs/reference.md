# t3tui reference

Everything t3tui does, by area. Most of it is also in the command palette (`ctrl+k`), which lists every action and its key.

- [Modes](#modes)
- [Keys](#keys)
- [The message box](#the-message-box)
- [The screen](#the-screen)
- [Mouse](#mouse)
- [Thread actions](#thread-actions)
- [New threads](#new-threads)
- [Attachments](#attachments)
- [Model, options and mode](#model-options-and-mode)
- [Terminals](#terminals)
- [Workspace](#workspace)
- [Alerts](#alerts)
- [Settings](#settings)

## Modes

The message box is always at the bottom. t3tui has two modes: **typing**, where keys go to the message box, and **navigation**, where single keys act. `esc` switches to navigation; `i`, `enter` or `tab` switch back. Drafts are kept per thread.

## Keys

Any mode:

| Key | Action |
| --- | --- |
| `ctrl+k` | command palette: every action below, plus thread search |
| `ctrl+j` | open the thread's terminal in the pane (see [Terminals](#terminals)) |
| `ctrl+\` | with the pane open: move the keys between it and the conversation |
| `ctrl+n` / `ctrl+p` (or `alt+↓`/`alt+↑`) | next / previous thread |
| `pgup`/`pgdn`, `ctrl+u`/`ctrl+d` | scroll the conversation (`ctrl+u`/`ctrl+d` only in navigation; while typing they edit the text) |
| `ctrl+c` | quit |

Navigation:

| Key | Action |
| --- | --- |
| `j`/`k`, arrows | next / previous thread (scroll, in `attach`) |
| `c` | new thread (see [New threads](#new-threads)) |
| `a` | attach a file to the next message (see [Attachments](#attachments)) |
| `.` | thread actions (see [Thread actions](#thread-actions)); a right-click on a thread opens them too |
| `m` | model, options (reasoning, fast mode…) and access mode |
| `T` | terminals: open in the pane, attach full screen, new, close or clear |
| `b` | branches and worktrees: switch, create, pull or remove |
| `E` | open the workspace (or diff file) in the server's editor |
| `y` / `Y` / `n` | approve / always allow this session / decline the pending approval |
| `1`–`9` | pick an option when the agent asks a question (also in an empty message box) |
| `x` | dismiss the agent's question, or decline its secret request |
| `enter` | with a secret request pending: type or paste the secret into a masked field (it never goes through the message box); `enter` saves it, `esc` cancels |
| `Q` | go through queued messages: `j`/`k` move, `enter` sends one now (starts a turn, or steers it into the running one), `e` edits it in the message box (`enter` saves, `esc` cancels), `x` removes it. `alt+↑` in the message box edits the last one |
| `e` | expand all folded turns, work groups and command output |
| `[` / `]` | select the previous / next turn; `esc` clears the selection |
| `D` | view changes from the selected turn, or the latest turn with changes |
| `R` | rewind to before the selected prompt, after confirmation |
| `o` | load earlier turns |
| `f` | find in the open thread; `enter` / `shift+enter` or `ctrl+n` / `ctrl+p` move between matches, `esc` closes |
| `A` | show archived threads / return to active threads |
| `J` / `K` | move the selected pinned thread down / up |
| `d` | show or hide thread details (kept for the next run) |
| `B` | hide or show the thread list (kept for the next run) |
| `P` | show the thread's linked pull request |
| `l` / `→` | move into the details panel: `j`/`k` choose, `enter` opens, `o` edits the selected changed file in the pane, `t` turns an automation on or off, `esc` comes back |
| `u` | go to the parent thread (from a fork or subagent) |
| `:` | command palette |
| `z` | show the Settled and Snoozed sections; `Show more settled threads` in the palette loads older rows |
| `/` | filter threads by title or project (the box opens at the top of the thread list) |
| `S` | stop the thread |
| `g` / `G` | top / bottom of the conversation |
| `esc` / `q` | close the diff or cancel a new thread; otherwise `q` quits |

## The message box

`enter` sends. While the agent is running, `enter` steers it (the message reaches it mid-run) and `alt+enter` queues the message for after the run; the `followUpBehavior` setting swaps the two. With an approval pending, a typed message declines it with your feedback.

`shift+enter` adds a newline (it needs a terminal with the kitty keyboard protocol); so does ending the line with `\` and pressing `enter`. The box grows up to 8 lines. `ctrl+g` opens the message in `$VISUAL` or `$EDITOR` (falling back to `vi`) in the terminal pane; save and quit to bring it back.

With the box empty after an interrupted run (or one a usage limit stopped), `enter` continues where it left off and releases messages held in the queue.

Typing a trigger opens a list of suggestions above the box:

| Trigger | Suggests | Inserts |
| --- | --- | --- |
| `/` | `/model`, then the provider's commands (only at the start of the message) and skills | `/command`, or `$skill` for a skill; `/model` opens the model picker |
| `$` | the provider's skills | `$skill` |
| `@` | threads, then files and folders in the thread's worktree or project | a markdown link to the file, or a link to the thread (sent along with the message) |
| `#` | pull requests in the thread's repository (by number, or by words in the title) | a link to the pull request (sent along with the message) |

`↑`/`↓` or `ctrl+n`/`ctrl+p` move, `tab`, `enter` or a click chooses, and `esc` closes the list. Links show as raw markdown in the box.

## The screen

The layout follows T3 Code's web app, and much of it uses the web app's own code.

- **Sidebar:** the same sections as the app (Pinned, Active, Working, then Snoozed and Settled folded to a count) and the same status words: `Working 2m`, `Waiting`, `Approval`, `Input`, `Request`, `Limited`, `Failed`, `Done`. Threads that need you are bold.
- **Conversation:** each finished turn's work folds into one line (`Worked for 3m 12s`), your messages sit in a raised block with a bar down the left, and a running turn shows its live step and `Working for 12s`. Threads open scrolled to the bottom. Long threads load as a window of recent turns; press `o` for older ones.
- **Turns:** `[`/`]` select a turn and mark its prompt. `R` or `Revert to this turn` asks `Edit from here?`, then rewinds the chat and returns the prompt to the message box, keeping file changes. `Revert files too` in the palette also restores files, including your own edits. Stop a running turn first. Rewinding messages with attachments still needs the app.
- **Command output:** expand work with `e` / `Expand all work`, or click a command. Output streams while its expanded row is in view; collapsing it, scrolling away or opening another thread stops it.
- **Thread details:** a column beside the conversation with the workspace, model and mode, the branch with ahead/behind and its pull request, uncommitted changes per file, lineage (forks and subagents), background work and the goal. It opens by itself on terminals 160 columns or wider; on narrow ones `d` shows it in place of the conversation.
- **Diffs:** pick `View diff` or a file under Changes to see uncommitted changes as unified diffs in place of the conversation. `D` (or `View changes from this turn`) reviews a turn's checkpoint; `View all changes in this thread` reviews the whole thread. `j`/`k` scroll, `[`/`]` choose a file, and `esc` closes. In uncommitted diffs, `x` or `enter` shows the whole file, including unchanged lines; press it again to collapse. Diffs of past checkpoints show only the changed lines.
- **Git:** the branch section offers the quick action (`Commit & push`, `Push`, `Create PR`…) and a menu of the rest. Every action asks first, says when you are on the default branch, and takes an optional commit message (leave it blank and T3 writes one). Progress shows on the bottom line.
- **Pull requests:** `P` shows a linked pull request in place of the conversation (with several, you pick one): its state, author and branches, description, checks, reviews, recent comments and the review guide when one was written. `j`/`k` scroll, `o` opens it in the browser, `r` refreshes it, and `esc` closes it. From there, `c` comments and `R` reviews (approve / request changes / comment) in `$EDITOR`, `a` offers the host's actions (merge, close, ready…) behind a confirmation, `w` watches or stops watching, and `u` unlinks it. `Link pull request to thread` in the palette links one by URL or number, and `New thread from pull request…` checks one out into a draft in the project folder or its own worktree.
- **Servers and automations:** local dev servers the thread started (stop one from the panel) and T3's scheduled tasks with their schedule and next run (run now, or turn on and off). `New automation` and `Edit automation: …` in the palette open the automation's fields in `$EDITOR` (title, schedule, project, workspace, model, mode, prompt); save and quit to save. `Delete automation: …` asks first. Webhook signatures and filters are left as they are; change those in the app.
- **Subagents:** subagent work in the conversation and the lineage rows in details are links; `enter` or a click opens the child thread, and `u` goes back. Idle subagents, which the thread list leaves out, are fetched when you open one. A running subagent gets a `Stop subagent` command in the palette.
- **Command palette:** `ctrl+k` searches commands and threads, then lists full-text hits with snippets under `In messages`; start with `>` for commands only. Message search needs a word of at least three letters.
- **Find in thread:** `f`, or `Find in thread` in the palette or thread menu, searches the whole conversation, counts matches, highlights them, and loads earlier history to reach the selected one. Matching Markdown shows as plain text while you search.
- **Archived threads:** `A` or `Show archived threads` opens the archive. Open a thread as usual; `Unarchive thread` in the palette restores it, and `Show active threads` returns to the live list.
- **Ordering:** `J` / `K` or `Move pinned thread down` / `up` in the palette reorder pinned threads. Active threads stay ordered by when they came back to you.
- **Read state:** opening a thread marks it read after a moment. Set `T3TUI_NO_VISIT=1` to turn that off.
- **Bottom line:** server restarts, update results and migration events flash here, along with reconnect status. If the connection drops, t3tui reconnects and resubscribes on its own; press `r` to retry straight away.

## Mouse

- **Select and copy:** drag across any text to select it; it's copied when you let go (through the terminal with OSC 52, and the desktop clipboard locally). A key press clears the highlight. Your terminal's own selection still works with shift held.
- **Buttons:** approvals, questions (click an option), secret requests, confirmations, queued messages (click one to send it now, edit or remove it), attached files (✕ removes one) and the PR view have buttons, each with its key beside it. Every hint along the bottom that names one key is clickable, and so is `commands` at the top.
- **Conversation:** a click on a prompt selects that turn, as `[`/`]` do; a click on a folded turn or work group opens just that one; a click on a command shows its output; "Load earlier turns" loads them. In a diff, a click on a file selects it and a second click shows the whole file. In the PR view, the URL opens in the browser.
- **Right-click menus:** on a thread (its actions), a prompt (copy, view its changes, revert), a reply (copy), a command (copy the command or its output) and the PR view (its actions).
- **Panes:** clicking the conversation takes the keys out of the message box or details; clicking the message box types. The wheel scrolls the conversation, the thread list (without moving the selection) and the palette. Drag the thread list's right edge, or the details column's left edge, to resize it; right-click the edge to reset it.

## Thread actions

`.`, `Thread actions…` in the palette, or a right-click on a thread opens the thread menu:

- New thread on the thread's branch (in its worktree, if it has one)
- Pin or unpin, settle or un-settle, snooze (T3's presets or a custom time) or wake
- Rename, regenerate the title, mark unread
- Auto-settle on or off for the thread (on servers that support turning it off)
- Copy the workspace path, branch, thread link or thread ID
- Archive or delete

Submenus open as their own list, and typing finds their items from the top (`thread id` finds `Copy › Thread ID`). A custom snooze takes a duration (`45m`, `3h`, `2d`, `1w`) or a time of day (`17:30`). Delete asks first; it leaves the thread's worktree alone, so remove that from the app or with `b`. Copying goes through the terminal (OSC 52, so it works over SSH), and through `wl-copy`, `xclip` or `pbcopy` on a local desktop. Project settings and guest sharing are only in the app.

## New threads

`c` (or `New thread` in the palette) opens a draft in the current thread's project, with the server's defaults: its model and mode for new threads, and the project folder or a new worktree as the project settings say. In the draft, `p` picks the project, `m` the model and mode, and `w` switches between the project folder and a new worktree off the default branch. Send the first message to start the thread; T3 titles it. `esc` cancels.

## Attachments

`a` in navigation (or `Attach file…` in the palette) prompts for a path: `~` expands, and a relative path is taken from the thread's worktree or project folder. `Paste image from clipboard` in the palette takes a clipboard image instead (`wl-paste`, `xclip`, or `pngpaste` on macOS). Files upload at once, and their names show above the message box until the next message sends them; `Remove attachment: …` in the palette takes one back. A message can be attachments alone.

Limits: GIF, JPEG, PNG and WebP images up to 10 MB each and 80 MB in all, other files up to the server's limit (50 MB at most), and 100 attachments per message.

## Model, options and mode

`m` (or a click on the model under the message box) opens a picker with the access mode, the model's options as the server describes them (reasoning effort, fast mode and whatever else the provider offers), and every model from the providers that are enabled and available.

- A new model or option applies from the next message you send; the line under the box shows `· next message` until then.
- The access mode changes at once.
- Once a thread has run, it stays on its provider; you can still change models within it.

## Terminals

`ctrl+j` opens the thread's terminal on the T3 server, the same one the app's terminal drawer shows, in the pane on the right. If the thread has none, it starts one in the thread's worktree or project folder; with several, you pick one or start another. The pane takes the details column's place and width (drag its edge to resize it); on a terminal too narrow for both, it takes the conversation's place.

While the pane has focus, every key goes to its program, `esc` included, apart from `ctrl+\`, which gives the keys back to the conversation. `ctrl+\` again, or a click on the pane, returns them; the pane's left edge shows the accent while it has them. The pane follows its size, and so does the terminal on the server: its size is shared, so it resizes for anyone else watching. When the shell exits, the pane closes; `Close the terminal pane` in the palette detaches without stopping it.

The same pane runs `$VISUAL` or `$EDITOR` (falling back to `vi`) on this machine: `ctrl+g` writes the message there, and `o` on a file under Changes in the details panel (or its `▸ Edit`) opens that file, when the workspace is on this machine. An open editor isn't replaced by anything else; quit it first.

`T` opens the terminal picker even with only one terminal. Choose `New terminal`, `Attach full screen` (the whole screen goes to the terminal until `ctrl+j` or `ctrl+]`), `Close terminal…` or `Clear terminal…`; typing `close` or `clear` finds each terminal's action directly. Closing ends the shell and deletes its history; clearing clears its scrollback. These are in the command palette too.

## Workspace

`b` opens the branch picker: local and remote refs, existing worktrees, `Create and switch ref…`, and `Pull`. Selecting a ref reuses its worktree if it has one; selecting the default branch returns to the project folder. `Create worktree…` asks for a new branch name and moves this thread there. `Remove worktree…` asks first, then removes the worktree only if no other thread uses it and Git allows it (it never forces). Moving the thread to another folder detaches its provider session.

While a worktree is being prepared, its stage, progress and any failure show above the message box. `Cancel worktree setup…` in the palette asks first.

`E` opens the workspace in an editor on the server. In a single-file diff it opens that file; in a whole-tree diff it asks which file. It picks from the server's available editors in the app's fallback order (t3tui can't see which editor your browser last used), and it can't jump to a line.

## Alerts

t3tui alerts when a thread you aren't watching finishes or needs you (approval, input, a request, a failure or a usage limit), on the same rules as T3 Code. Subagents don't alert. Depending on `notificationMode`:

- **Bell:** the terminal bell.
- **Desktop notifications:** sent through the terminal (OSC 9, or OSC 99 in kitty), only when the terminal window isn't focused. Under tmux they need `set -g allow-passthrough on`.

While the terminal is focused, alerts for other threads also show on the bottom line (`inAppNotificationsEnabled`).

## Settings

Open them from the command palette (`Settings`). `j`/`k` move, `enter` or a click changes one, and changes save to `~/.config/t3tui/config.json`:

| Setting | Choices | Default |
| --- | --- | --- |
| `followUpBehavior` | `steer` or `queue`: what `enter` does while the agent runs (`alt+enter` does the other) | `steer` |
| `sendShortcut` | `enter`, or `ctrl-enter` (then `enter` adds a line; needs the kitty keyboard protocol, and `alt+enter` also sends) | `enter` |
| `timestampFormat` | `locale`, `12-hour`, `24-hour` | `locale` |
| `diffIgnoreWhitespace` | `true`, `false` | `true` |
| `notificationMode` | `off`, `sound` (bell), `notifications` (desktop), `notifications-and-sound` | `sound` |
| `inAppNotificationsEnabled` | `true`, `false` | `true` |
| `theme` | `auto` (match the terminal), `dark`, `light`; applies from the next start | `auto` |

They have the same names as the app's settings. The app keeps its settings in the browser, so t3tui keeps its own, and turns the two alert settings on by default where the app leaves them off.

The same view shows the server settings that matter here (model and mode for new threads, auto-settle, rate-limited threads), read-only; change those in the app. Below them is usage: each provider's limit windows as room left, its banked reset credits, and the last 30 days' cost and tokens. When a window is 90% used or more, the top line says so. `Use reset credit: …` in the palette spends a banked credit, after asking.
