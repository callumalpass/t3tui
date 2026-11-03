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
- [Panes](#panes)
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
| `ctrl+j` | show or hide the thread's terminal drawer (see [Terminals](#terminals)) |
| `ctrl+\` | the panes' prefix, then one key: `ctrl+\` moves the keys between the conversation and the last pane, `tab` / `shift+tab` to the next / previous pane, `j` the drawer, `l` the column, `k` or `h` the conversation; `1`–`9` pick a tab, `x` closes one, `z` zooms, `n` opens a terminal (see [Panes](#panes)) |
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
| `T` | terminals: open one in the drawer, attach full screen, new, close or clear |
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
| `d` | show or hide the right-hand column: thread details, the workspace's files, and a tab for each open editor, file preview and, placed at the side, each terminal (kept for the next run) |
| `F` | the Files tab: browse the thread's worktree, or its project folder (see [Files](#files)) |
| `B` | hide or show the thread list (kept for the next run) |
| `P` | show the thread's linked pull request |
| `l` / `→` | move into the details panel: `j`/`k` choose, `enter` opens, `o` edits the selected changed file in a tab of the column, `t` turns an automation on or off, `esc` comes back |
| `u` | go to the parent thread (from a fork or subagent) |
| `:` | command palette |
| `z` | show the Settled and Snoozed sections; `Show more settled threads` in the palette loads older rows |
| `/` | filter threads by title or project (the box opens at the top of the thread list) |
| `S` | stop the thread |
| `g` / `G` | top / bottom of the conversation |
| `esc` / `q` | close the diff or cancel a new thread; otherwise `q` quits |

## The message box

`enter` sends. While the agent is running, `enter` steers it (the message reaches it mid-run) and `alt+enter` queues the message for after the run; the `followUpBehavior` setting swaps the two. With an approval pending, a typed message declines it with your feedback.

`shift+enter` adds a newline (it needs a terminal with the kitty keyboard protocol); so does ending the line with `\` and pressing `enter`. The box grows up to 8 lines. `ctrl+g` opens the message in `$VISUAL` or `$EDITOR` (falling back to `vi`) in the message box's place; save and quit to bring it back.

`ctrl+v` attaches the clipboard's image, or pastes its text when there is no image. Pasting or dropping the path of an image file (quoted, as a `file://` URL, or with `\ ` before spaces) attaches the file rather than typing the path. See [Attachments](#attachments).

Attachments and `@` files show in the box as chips, `[image 1]` or `@src/ui/App.tsx`, in the accent colour: the cursor steps over one in a single move and `backspace` deletes it whole. Deleting an attachment's chip removes the attachment. The text sent is what it was without chips: an attachment's chip is left out, and an `@` file goes as its markdown link.

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
- **Conversation:** each finished turn's work folds into one line (`Worked for 3m 12s`), your messages sit in a raised block with a bar down the left, and a running turn shows its live step and `Working for 12s`. Replies render as markdown while they stream, tables included, and settle into their final form when done; at the bottom the newest line stays in view, and scrolled up the text you're reading stays put. Threads open scrolled to the bottom. Long threads load as a window of recent turns; press `o` for older ones.
- **Turns:** `[`/`]` select a turn and mark its prompt. `R` or `Revert to this turn` asks `Edit from here?`, then rewinds the chat and returns the prompt to the message box, keeping file changes. `Revert files too` in the palette also restores files, including your own edits. Stop a running turn first. Rewinding messages with attachments still needs the app.
- **Command output:** expand work with `e` / `Expand all work`, or click a command. Output streams while its expanded row is in view; collapsing it, scrolling away or opening another thread stops it.
- **Thread details:** a column beside the conversation with the workspace, model and mode, the branch with ahead/behind and its pull request, uncommitted changes per file, lineage (forks and subagents), background work and the goal. It opens by itself on terminals 160 columns or wider; on narrow ones `d` shows it in place of the conversation. A strip of tabs at its top reads `Details · Files`, then a tab for each file open in an editor or a preview and each terminal placed at the side: click one, or press `ctrl+\` then its number.
- **Diffs:** pick `View diff` or a file under Changes to see uncommitted changes in place of the conversation: side by side when the conversation is at least 140 columns wide, unified otherwise. `Toggle split diff` in the palette switches between the two for the rest of the session. `D` (or `View changes from this turn`) reviews a turn's checkpoint; `View all changes in this thread` reviews the whole thread. `j`/`k` scroll, `[`/`]` choose a file, and `esc` closes. In uncommitted diffs, `x` or `enter` shows the whole file, including unchanged lines; press it again to collapse. Diffs of past checkpoints show only the changed lines.
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

- **Select and copy:** drag across any text, in the conversation or a terminal or editor, to select it; it's copied when you let go (through the terminal with OSC 52, and the desktop clipboard locally) and `Copied` shows at the bottom. A program in a terminal or editor that takes the mouse itself, like an editor with mouse support, gets the drag instead. A single click still does what it did. A key press clears the highlight. Your terminal's own selection still works with shift held.
- **Buttons:** approvals, questions (click an option), secret requests, confirmations, queued messages (click one to send it now, edit or remove it), attached files (✕ removes one) and the PR view have buttons, each with its key beside it. Every hint along the bottom that names one key is clickable, and so is `commands` at the top.
- **Conversation:** a click on a prompt selects that turn, as `[`/`]` do; a click on a folded turn or work group opens just that one; a click on a command shows its output; "Load earlier turns" loads them. In a reply, links are underlined in the accent colour and a click opens them in the browser (`xdg-open`, or `open` on macOS); a click on a path to a file in the workspace, like `src/ui/App.tsx:12`, opens it in a tab of the right-hand column. In a diff, a click on a file selects it and a second click shows the whole file. In the PR view, the URL opens in the browser. In the Files tab, a click selects a row, a click on a folder opens or closes it, and a click on the selected file opens it.
- **Right-click menus:** on a thread (its actions), a prompt (copy, view its changes, revert), a reply (copy), a command (copy the command or its output) and the PR view (its actions).
- **Panes:** clicking the conversation takes the keys out of the message box, details or a pane; clicking the message box types; clicking a pane gives it the keys. A click on a tab switches to it, the active tab's ✕ closes it, and a middle-click closes any tab. The wheel scrolls the conversation, the thread list (without moving the selection) and the palette. Drag the thread list's right edge, the right-hand column's left edge or the terminal drawer's top edge to resize it; right-click the edge to reset it.

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

`a` in navigation (or `Attach file…` in the palette) prompts for a path: `~` expands, and a relative path is taken from the thread's worktree or project folder. `ctrl+v` in the message box, or `Paste image from clipboard` in the palette, takes the clipboard's image instead (PNG, JPEG, WebP or GIF), as does a paste that comes through empty, which is how many terminals pass on a copied image. The clipboard is read through OpenTUI, then `wl-paste` or `xclip` (or `pngpaste` or `osascript` on macOS) when that finds nothing it can read. Over SSH the clipboard is on the other machine, so use `a` there. Pasting an image file's path attaches the file. Files upload at once, and their names show above the message box until the next message sends them; `Remove attachment: …` in the palette takes one back. A message can be attachments alone.

Sent images show in their message, up to 12 rows tall, through kitty or sixel graphics where the terminal has them and as coloured blocks elsewhere; the file's name is under each.

Limits: GIF, JPEG, PNG and WebP images up to 10 MB each and 80 MB in all, other files up to the server's limit (50 MB at most), and 100 attachments per message.

## Model, options and mode

`m` (or a click on the model under the message box) opens a picker with the access mode, the model's options as the server describes them (reasoning effort, fast mode and whatever else the provider offers), and every model from the providers that are enabled and available.

- A new model or option applies from the next message you send; the line under the box shows `· next message` until then.
- The access mode changes at once.
- Once a thread has run, it stays on its provider; you can still change models within it.

## Terminals

`ctrl+j` opens the thread's terminal on the T3 server in a drawer below the message box; `ctrl+j` again hides it. If the thread has none, it starts one in the thread's worktree or project folder. The drawer takes 40% of the conversation's height at first; drag its top edge to resize it (the height is kept for the next run) and right-click the edge to reset it. On a window too short to leave the conversation 10 rows, the drawer takes the conversation's place.

Each of the thread's terminals has a tab at the top of the drawer: click one, or press `ctrl+\` then its number, to switch; `+ new` (or `ctrl+\ n`) starts another. A terminal that closes or exits takes its tab away, and the last one the drawer. Each thread keeps its own drawer, so another thread shows its own terminals, and `ctrl+j` brings back the one you last had. While the drawer is hidden, a strip under the message box names the terminals you opened this run, `▸ Terminal 1 · Terminal 2   ctrl+j`; click one to bring it back.

While the drawer has focus, every key goes to its program, `esc` included, apart from `ctrl+\` (see [Panes](#panes)) and `ctrl+j`, which hides the drawer. The terminal follows the drawer's size, and so does the terminal on the server: its size is shared, so it resizes for anyone else watching. `Terminal: hide` in the palette detaches without stopping it.

`Pane: move terminal to the side` in the palette puts terminals in the right-hand column instead, each a tab in the column's one strip: `Details · <editors> · Terminal 1 · Terminal 2 · + new`. `Pane: move terminal below` puts them back. The choice is kept for the next run. A narrow column cuts long tab names to fit; drag its edge to widen it.

`$VISUAL` or `$EDITOR` (falling back to `vi`) runs on this machine in the same way: `ctrl+g` writes the message in it, in the message box's place, and `o` on a file under Changes in the details panel (or its `▸ Edit`), or a click on a workspace path in a reply, opens that file in a tab of the right-hand column, when the workspace is on this machine. Each file gets its own tab, named by its path in the workspace (cut from the middle when long, `src/…/TerminalPane.tsx`). With Neovim (`nvim`), the first file starts it with `--listen` on a socket in a temp folder, and later files open in that same Neovim (`--server … --remote-expr`), whose tab takes the keys and the file's name. When an editor exits, its tab closes and the column goes back to Details, or hides again if the editor is what showed it. With the column hidden (`d`) while an editor runs, `Editor: <file> · d` shows at the right of the strip under the message box, or of the header, with `●` when Neovim has unsaved changes.

`T` opens the terminal picker even with only one terminal. Choose `New terminal`, `Attach full screen` (the whole screen goes to the terminal until `ctrl+j` or `ctrl+]`), `Close terminal…` or `Clear terminal…`; typing `close` or `clear` finds each terminal's action directly. Closing ends the shell and deletes its history, so it asks first; clearing clears its scrollback. The palette has the same under `Terminal:` (`Terminal: open`, `Terminal: new`, `Terminal: attach full screen`, `Terminal: pick…`), with close and clear for the active terminal (`Terminal: close Terminal 1`).

## Panes

The drawer, the message editor and the column's Files, editor, preview and terminal tabs are panes. Focus moves through whichever are open in one order: the conversation (and message box), the message editor, the drawer, the column, and back. The hint bar names the pane that has the keys, `keys: Terminal 1`, and its strip lights up: a raised background, the active tab in the accent, and an accent edge down its left. Panes without the keys go quiet, and so does the message box's bar.

`ctrl+\` is a prefix, wherever the keys are, a program included. The hint bar shows the keys it waits for, `ctrl+\ … tab next · j drawer · l column · 1-9 tab · x close · z zoom · n new · esc cancel`, for about two seconds. Then:

| Key | Action |
| --- | --- |
| `ctrl+\` | move the keys between the conversation and the pane that last had them |
| `tab` / `shift+tab` | the next / previous pane in the order above |
| `j` | the drawer, opening it if it's hidden |
| `l` | the column's tab it showed last (from Details: the first editor, preview or terminal, else Files), showing the column if it's hidden |
| `k` / `h` | back to the conversation |
| `1`–`9` | that tab of the focused strip: the drawer's terminals, or the column's tabs; with no pane focused, the drawer's |
| `x` | close the focused tab: a preview at once; a terminal after asking; Neovim is asked to quit (`:confirm qa`, so it asks about unsaved changes itself); other editors are left for you to quit, since closing them could lose work |
| `z` | zoom: the focused pane (or, from the conversation, the last one) fills the conversation's area until `z` again; the thread list stays |
| `n` | a new terminal |
| `esc`, any other key | cancel |

A key after the prefix never reaches the program, and a program can't receive `ctrl+\` itself. `Pane: next` and `Pane: zoom` are in the palette too.

## Files

`F`, or `Files: show` in the palette, shows the column's Files tab with the keys in it: the thread's worktree, or its project folder when it has none, as a tree. The top line names the root (`~/…/project`). Folders list when you first open them (`…` while they load) and stay open per workspace until t3tui quits. Folders come first; `.git` is left out. What git ignores is faint, and the Changes list's marks sit on the right: `M` for a modified file, `?` for an untracked one (and everything in an untracked folder), and a faint `•` on a folder with changes inside. Open folders list again when a turn finishes or git's status changes, each time the tab is shown, and on `r`.

| Key | Action |
| --- | --- |
| `j`/`k`, arrows | move |
| `l` / `enter` / `→` | open a folder, or open a file: in an editor tab when it's on this machine, otherwise in a read-only preview |
| `h` / `←` | close the folder, or go to its parent |
| `g` / `G` | first / last row |
| `/` | search the workspace: type, then `↑`/`↓` and `enter` (a folder shows in the tree), `tab` to move into the results; `esc` returns to the tree where you left it |
| `m` | mention the file or folder in the message box, as the `@` menu does; the keys stay in the tree |
| `y` | copy the path |
| `p` | preview the file, even when it's on this machine |
| `r` | list everything again |
| `esc` | back to the conversation |

Results take the same keys (`j`/`k`, `enter`, `m`, `y`, `p`). A preview is a tab of its own, titled with the path: code is highlighted by its extension, markdown is rendered, images are drawn, and other binary files show their size. `j`/`k` scroll it, `space`/`pgdn` and `pgup` page, `g`/`G` go to the ends, and `ctrl+\ x` or the tab's ✕ closes it and returns to Files. Files are read through the server, so previews work over SSH too. The Files tab can't be closed; `d` hides the column. Creating, renaming or deleting files is left to the agent or your editor.

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
| `theme` | `auto` (dark or light, from the terminal's background), `dark`, `light`, or `terminal` (built from the terminal's own background, text and 16 ANSI colours); applies from the next start. Terminals that don't report their colours get `dark`. | `auto` |

They have the same names as the app's settings. The app keeps its settings in the browser, so t3tui keeps its own, and turns the two alert settings on by default where the app leaves them off.

The same view shows the server settings that matter here (model and mode for new threads, auto-settle, rate-limited threads), read-only; change those in the app. Below them is usage: each provider's limit windows as room left, its banked reset credits, and the last 30 days' cost and tokens. When a window is 90% used or more, the top line says so. `Use reset credit: …` in the palette spends a banked credit, after asking.
