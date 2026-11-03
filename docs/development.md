# Developing t3tui

## Running from source

`t3tui` runs the bundle in `dist/`, which uses over 100 MB less memory than the sources. After pulling changes, run `bun run build` (or `bun install`) to rebuild it; `bun run dev` runs the sources directly.

Set `T3TUI_DEBUG=/path/to/log` to log thread subscriptions and snapshots.

## How it connects

- It finds the local server from `~/.t3/userdata/server-runtime.json` (override with `T3TUI_SERVER`).
- On first run it mints its own bearer session with `t3 auth session issue --label t3tui`, scoped to `orchestration:read`, `orchestration:operate` (attachments and automations ride on it), `filesystem:read` (diffs), `source-control:write` (git actions), `terminal:read` and `terminal:operate` (terminals, stopping servers), `diagnostics:read` (usage totals) and `providers:manage` (reset credits), and stores it in `~/.config/t3tui/credentials.json` (mode 600). A stored credential missing any of these scopes is replaced with a new one. Revoke it any time with `t3 auth session revoke`. For a remote server, pass a token in `T3TUI_TOKEN`.
- It speaks T3 Code's own WebSocket RPC protocol, typed by upstream's `@t3tools/contracts`, and applies thread updates with upstream's own reducers. Both come from `vendor/t3code`, a submodule pinned to the server version this was built against (`v0.1.6-nightly.20261030.3917`).

## Following the web app

t3tui aims to behave like T3 Code's web app: the same sidebar sections and status words, timeline, thread menu, palette scoring, alert rules, setting names and defaults (except the two alert settings), attachment limits, and editor fallback order. Where it can, it uses the web app's own code from `vendor/t3code` rather than reimplementing it. When a behaviour differs, that's either a gap (listed under "Not yet supported" in the README) or a terminal constraint, such as links showing as raw markdown in the message box instead of chips.

Some gaps come from the pinned server rather than t3tui: it doesn't publish update-available or shutting-down events, historical checkpoint diffs have no unchanged context, and the open-in-editor RPC has no line argument.

## Updating for a newer T3 Code

The protocol packages are private and change without notice, so t3tui tracks a pinned upstream tag:

```sh
cd vendor/t3code && git fetch --depth 1 origin tag <tag> && git checkout <tag> && cd -
bun install && bun run typecheck && bun test
```

Type errors after a bump point at the protocol changes to adapt to.

## Releasing

Releases are standalone binaries built with `bun build --compile`, so users don't need Bun or a checkout. To cut one, bump `version` in `package.json`, commit, and push a matching tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The [Release workflow](../.github/workflows/release.yml) compiles linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64 on one machine, opens each binary's dashboard on its own OS (on Windows it only runs `t3tui version`), and publishes them gzipped with a `SHA256SUMS` file, which `install.sh`, `install.ps1` and `t3tui upgrade` all check. Run the workflow by hand to build and check the binaries without releasing.

To build a binary locally, run `bun run compile` (this machine) or name targets, e.g. `bun run compile darwin-arm64`. Other platforms' targets need their OpenTUI packages: `bun install --os='*' --cpu='*'`. Binaries go in `release/`.
