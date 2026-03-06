#!/bin/bash
# Clawchestra - Update Script
# Run this to rebuild the app with latest changes.
# Triggered by the in-app Update button.
# Builds in the background, then replaces the installed app and restarts it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Clawchestra"
INSTALL_PATH="${CLAWCHESTRA_INSTALL_PATH:-/Applications/$APP_NAME.app}"
RESTART_AFTER_BUILD="${CLAWCHESTRA_RESTART_AFTER_BUILD:-1}"
TMP_ROOT="${TMPDIR:-/tmp}"
LOCK_DIR="$TMP_ROOT/clawchestra-update.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
BUILD_DIR="$SCRIPT_DIR"
TMP_WORKTREE=""

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID_FILE"
    return 0
  fi

  # Lock exists. If the process is still alive, another update is running.
  if [ -f "$LOCK_PID_FILE" ]; then
    EXISTING_PID="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
    if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
      echo "ℹ️ Update already in progress (pid $EXISTING_PID)."
      exit 0
    fi
  fi

  # Stale lock: clear and retry once.
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID_FILE"
    return 0
  fi

  echo "❌ Could not acquire update lock."
  exit 1
}

cleanup_lock() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

cleanup_worktree() {
  if [ -z "${TMP_WORKTREE:-}" ]; then
    return
  fi
  if [ -d "$TMP_WORKTREE" ]; then
    git -C "$SCRIPT_DIR" worktree remove --force "$TMP_WORKTREE" >/dev/null 2>&1 || rm -rf "$TMP_WORKTREE"
  fi
}

cleanup_all() {
  cleanup_worktree
  cleanup_lock
}

repo_is_dirty() {
  if git -C "$SCRIPT_DIR" status --porcelain --untracked-files=normal | grep -q .; then
    return 0
  fi
  return 1
}

prepare_clean_worktree() {
  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi
  if ! git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 1
  fi
  if ! repo_is_dirty; then
    return 1
  fi

  TMP_WORKTREE="$(mktemp -d "$TMP_ROOT/clawchestra-update-worktree.XXXXXX")"
  echo "ℹ️ Retrying from clean HEAD worktree: $TMP_WORKTREE"

  if git -C "$SCRIPT_DIR" worktree add --detach "$TMP_WORKTREE" HEAD >/dev/null; then
    if [ -d "$SCRIPT_DIR/node_modules" ] && [ ! -e "$TMP_WORKTREE/node_modules" ]; then
      ln -s "$SCRIPT_DIR/node_modules" "$TMP_WORKTREE/node_modules"
    fi
    if [ -d "$SCRIPT_DIR/src-tauri/target" ] && [ ! -e "$TMP_WORKTREE/src-tauri/target" ]; then
      mkdir -p "$TMP_WORKTREE/src-tauri"
      ln -s "$SCRIPT_DIR/src-tauri/target" "$TMP_WORKTREE/src-tauri/target"
    fi
    BUILD_DIR="$TMP_WORKTREE"
    return 0
  fi

  echo "⚠️ Failed to create clean worktree."
  rm -rf "$TMP_WORKTREE"
  TMP_WORKTREE=""
  return 1
}

build_app_bundle() {
  local dir="$1"
  cd "$dir"
  pnpm install --frozen-lockfile
  pnpm tauri build --bundles app
}

acquire_lock
trap cleanup_all EXIT

echo "🔨 Building Clawchestra..."
cd "$BUILD_DIR"

# Ensure cargo and pnpm are in PATH
source ~/.cargo/env 2>/dev/null || true
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:$HOME/.local/share/pnpm:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm not found in PATH. Ensure Node/pnpm is installed."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "❌ cargo not found in PATH. Ensure Rust toolchain is installed."
  exit 1
fi

# Build app bundle only (no DMG).
if ! build_app_bundle "$SCRIPT_DIR"; then
  if prepare_clean_worktree; then
    echo "⚠️ Initial build failed. Retrying from clean HEAD..."
    build_app_bundle "$BUILD_DIR"
  else
    exit 1
  fi
fi

BUNDLE_PATH="$BUILD_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"

if [ ! -d "$BUNDLE_PATH" ]; then
  echo "❌ Build failed - no app bundle found at: $BUNDLE_PATH"
  exit 1
fi

if [ "$RESTART_AFTER_BUILD" != "1" ]; then
  echo "✅ Build complete (restart disabled)"
  echo "   Built at: $(date)"
  exit 0
fi

TARGET_DIR="$(dirname "$INSTALL_PATH")"
STAGED_PATH="$TARGET_DIR/.${APP_NAME}.updated.app"

echo "📦 Staging updated app at: $STAGED_PATH"
rm -rf "$STAGED_PATH"
cp -R "$BUNDLE_PATH" "$STAGED_PATH"

echo "🔁 Applying update and restarting app..."
killall "clawchestra" 2>/dev/null || true
# Wait for the process to fully exit and for macOS to release window resources
# before opening the new binary. 0.5s was too short — displays aren't always
# re-enumerated by the time restoreStateCurrent fires, causing fallback to min size.
sleep 1.5
rm -rf "$INSTALL_PATH"
mv "$STAGED_PATH" "$INSTALL_PATH"
open "$INSTALL_PATH"

echo "✅ Update applied and app restarted"
echo "   Built at: $(date)"
