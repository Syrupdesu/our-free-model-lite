#!/usr/bin/env bash
# Install this lite build into a DSH desktop profile, with a backup and a
# restore-on-failure trap.
#
#   ./scripts/install.sh /path/to/dsh-our-free-model-3.0.0-lite.1.tgz
#
# The profile defaults to ~/.dsh/profiles/desktop; override with DSH_PROFILE_DIR.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="3.0.0-lite.1"
TGZ="${1:-$HERE/dsh-our-free-model-${VERSION}.tgz}"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"

[[ -f "$TGZ" ]] || { echo "tarball not found: $TGZ" >&2; exit 1; }
[[ -f "$PROFILE/package.json" ]] || { echo "not a DSH profile: $PROFILE" >&2; exit 1; }
[[ -d "$PROFILE/node_modules/dsh-our-free-model" ]] || { echo "the plugin is not installed in $PROFILE" >&2; exit 1; }

BACKUP="$PROFILE/.ofmlite-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp "$PROFILE/package.json" "$PROFILE/pnpm-lock.yaml" "$BACKUP/"
cp -R "$PROFILE/node_modules/dsh-our-free-model" "$BACKUP/plugin"
echo "backup: $BACKUP"

restore() {
  echo "restoring the previous install…" >&2
  rm -rf "$PROFILE/node_modules/dsh-our-free-model"
  cp -R "$BACKUP/plugin" "$PROFILE/node_modules/dsh-our-free-model"
  cp "$BACKUP/package.json" "$BACKUP/pnpm-lock.yaml" "$PROFILE/"
}
trap 'restore' ERR

mkdir -p "$PROFILE/vendor"
cp "$TGZ" "$PROFILE/vendor/dsh-our-free-model-${VERSION}.tgz"

python3 - "$PROFILE/package.json" "$VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path) as fh:
    data = json.load(fh)
data.setdefault('dependencies', {})['dsh-our-free-model'] = f'file:./vendor/dsh-our-free-model-{version}.tgz'
with open(path, 'w') as fh:
    json.dump(data, fh, indent=2)
    fh.write('\n')
PY

cd "$PROFILE"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false
elif command -v corepack >/dev/null 2>&1; then
  CI=true COREPACK_HOME="${COREPACK_HOME:-$HOME/.cache/corepack}" \
    corepack pnpm@11.28.5 install --no-frozen-lockfile --config.confirmModulesPurge=false
else
  echo "neither pnpm nor corepack is available; run 'pnpm install' in $PROFILE yourself" >&2
fi

node -e "const v=require('$PROFILE/node_modules/dsh-our-free-model/package.json').version; if (v !== '$VERSION') { console.error('unexpected version', v); process.exit(1) }" \
  || { echo "installed version mismatch" >&2; restore; exit 1; }

trap - ERR
echo "installed dsh-our-free-model $VERSION into $PROFILE"
echo "restart DeepSeek Harness to load it; revert with:"
echo "  ./scripts/revert.sh '$BACKUP'"
