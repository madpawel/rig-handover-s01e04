#!/usr/bin/env bash
set -euo pipefail
umask 077

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
[[ $# -le 1 ]] || { echo 'Usage: scripts/export-preview.sh [output.html]' >&2; exit 1; }
port=${PREVIEW_PORT:-18787}
[[ $port =~ ^[0-9]+$ && ${#port} -le 5 ]] && (( 10#$port > 0 && 10#$port <= 65535 )) || {
  echo 'PREVIEW_PORT must be an integer from 1 to 65535.' >&2; exit 1;
}
port=$((10#$port))
output=$(realpath -m -- "${1:-var/preview/index.html}")
case "$output" in
  "$root"/var/*) ;;
  "$root"|"$root"/*) echo 'Output inside this repository must be under var/.' >&2; exit 1 ;;
esac
# Refuse existing tracked files even if repository layout changes later.
if git ls-files --error-unmatch -- "$output" >/dev/null 2>&1; then
  echo 'Refusing to overwrite a tracked file.' >&2; exit 1
fi
mkdir -p -- "$(dirname -- "$output")"
# Resolve again after creating directories, including any symlinked ancestors.
[[ $(realpath -m -- "$output") == "$output" ]] || { echo 'Output path changed.' >&2; exit 1; }
log=$(mktemp)
staging=$(mktemp "$(dirname -- "$output")/.rig-preview.XXXXXX")
pid=''
cleanup() {
  if [[ -n $pid ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f -- "$log" "$staging"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# A successful listen callback in this private log proves this process bound the port;
# an unrelated server already on the port cannot satisfy readiness.
PORT="$port" ./node_modules/.bin/tsx --env-file-if-exists=.env src/server.ts >"$log" 2>&1 &
pid=$!
ready=false
for ((attempt=0; attempt<100; attempt++)); do
  kill -0 "$pid" 2>/dev/null || { echo 'Preview server exited before readiness (port may be occupied).' >&2; exit 1; }
  if grep -Fq "http://localhost:$port" "$log"; then
    ready=true
    break
  fi
  sleep 0.1
done
[[ $ready == true ]] || { echo 'Preview server readiness timed out.' >&2; exit 1; }
curl --fail --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 15 \
  "http://127.0.0.1:$port/digest/2026-10-28" -o "$staging"
# The usual server layout supplies the lane banner and inline CSS. Reject resources
# that would make the saved document depend on the live service or client scripts.
node --input-type=module - "$staging" <<'NODE'
import { readFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8');
if (!/<!doctype html/i.test(html) || !/<style[\s>]/i.test(html) ||
    !/<header[\s>]/i.test(html) || !/class="marker"/.test(html) ||
    /<script\b|<(?:link|iframe|object|embed)\b|\b(?:src|srcset)\s*=|url\s*\(|@import\b/i.test(html)) {
  console.error('Export must be a self-contained HTML document without client scripts.');
  process.exit(1);
}
NODE
mv -f -- "$staging" "$output"
echo 'Preview exported (HTML and lane marker not logged).'
