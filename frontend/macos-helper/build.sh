#!/usr/bin/env bash
# Builds the two macOS M0 apps and assembles them into frontend/macos-helper/dist.
# Usage: ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"

DIST="./dist"
rm -rf "$DIST"
mkdir -p "$DIST"

build_app() {
  local target="$1" plist="$2"
  local app="$DIST/$target.app"
  mkdir -p "$app/Contents/MacOS"
  cp "$BIN_DIR/$target" "$app/Contents/MacOS/$target"
  cp "Resources/$plist" "$app/Contents/Info.plist"
  # Ad-hoc signature: enough for local testing. Note: every rebuild changes the
  # signature, so macOS may ask you to re-enable the permission after a rebuild.
  codesign --force --sign - "$app" >/dev/null
}

build_app QuickNoteHelper Info-QuickNoteHelper.plist
build_app BridgeProbe Info-BridgeProbe.plist

echo "Built:"
echo "  dist/QuickNoteHelper.app   (menu-bar chord helper)"
echo "  dist/BridgeProbe.app       (one-shot bridge delivery test)"
