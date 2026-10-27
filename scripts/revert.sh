#!/usr/bin/env bash
# Restore the profile exactly as it was before scripts/install.sh.
#   ./scripts/revert.sh <backup-dir>
set -euo pipefail
BACKUP="${1:?usage: revert.sh <backup-dir>}"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
[[ -d "$BACKUP/plugin" ]] || { echo "not an install backup: $BACKUP" >&2; exit 1; }
rm -rf "$PROFILE/node_modules/dsh-our-free-model"
cp -R "$BACKUP/plugin" "$PROFILE/node_modules/dsh-our-free-model"
cp "$BACKUP/package.json" "$BACKUP/pnpm-lock.yaml" "$PROFILE/"
echo "restored $PROFILE from $BACKUP"
echo "restart DeepSeek Harness to load the previous build."
