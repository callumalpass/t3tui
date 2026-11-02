#!/bin/sh
# Installs the t3tui binary for this machine from GitHub Releases:
#   curl -fsSL https://raw.githubusercontent.com/callumalpass/t3tui/main/install.sh | sh
# T3TUI_INSTALL_DIR picks where it goes (default ~/.local/bin); T3TUI_VERSION picks a release (e.g. 0.1.0).
set -eu

repo=callumalpass/t3tui
dir=${T3TUI_INSTALL_DIR:-"$HOME/.local/bin"}

fail() {
  echo "t3tui install: $*" >&2
  exit 1
}

case $(uname -s) in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "no release for $(uname -s); build from source instead: https://github.com/$repo#build-from-source" ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "no release for $(uname -m); build from source instead: https://github.com/$repo#build-from-source" ;;
esac
# A shell under Rosetta reports x86_64 on Apple silicon; the native binary is the better fit.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
  arch=arm64
fi
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "the releases need glibc, and this system uses musl; build from source instead: https://github.com/$repo#build-from-source"
fi

file="t3tui-$os-$arch.gz"
if [ -n "${T3TUI_VERSION:-}" ]; then
  base="https://github.com/$repo/releases/download/v${T3TUI_VERSION#v}"
else
  base="https://github.com/$repo/releases/latest/download"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $file..."
curl -fL --progress-bar -o "$tmp/$file" "$base/$file" || fail "couldn't download $base/$file"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || fail "couldn't download $base/SHA256SUMS"

expected=$(awk -v f="$file" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$file" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "$file doesn't match its checksum; nothing was installed"

gunzip "$tmp/$file"
chmod 755 "$tmp/t3tui-$os-$arch"
mkdir -p "$dir"
mv "$tmp/t3tui-$os-$arch" "$dir/t3tui"
echo "Installed $("$dir/t3tui" version) to $dir/t3tui"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "$dir isn't on your PATH. Add it, e.g. in your shell's rc file: export PATH=\"$dir:\$PATH\"" ;;
esac
