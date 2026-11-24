#!/bin/sh
# Runs the real selection, SDK controls and footer layout in isolated headless Chrome.
# CHROME overrides the binary; no host account or project data is used.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
tmp=$(mktemp -d "${TMPDIR:-/private/var/folders/bp/hd9tmk0s17g876b4zgcdwb3m0000gn/T/opencode}/bulk-toolbar.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
"$root/node_modules/.bin/esbuild" "$root/test/browser/bulkToolbar.ts" --bundle --format=esm --outfile="$tmp/check.js" --log-level=warning
printf '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="check.js"></script>' > "$tmp/index.html"
for size in 390,844 1440,900; do
  "$chrome" --headless=new --disable-gpu --no-first-run --allow-file-access-from-files \
    --user-data-dir="$tmp/profile-$size" --window-size="$size" --virtual-time-budget=2000 \
    --dump-dom "file://$tmp/index.html" > "$tmp/result.html" 2> "$tmp/chrome.log"
  if grep -q 'id="test-result"[^>]*data-result="pass"' "$tmp/result.html"; then
    echo "PASS: bulk toolbar at $size"
  else
    sed -n 's/.*<p id="test-result"[^>]*>\([^<]*\)<\/p>.*/\1/p' "$tmp/result.html"
    echo "FAIL: bulk toolbar at $size"
    exit 1
  fi
done
