#!/bin/sh
# DEBUG check, not part of `npm test`: a card dragged sideways from the end of a long column must
# drop into the column beside it, however short that column's own list is. Runs the real styles and
# drag code in headless Chrome (entry.ts). Exit 0: every line is PASS.
#   sh scripts/debug/drag-across-columns/run.sh
# CHROME overrides the browser binary.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
"$root/node_modules/.bin/esbuild" "$here/entry.ts" --bundle --format=iife --outfile="$tmp/bundle.js" --log-level=warning
printf '<!doctype html><html><body><script src="bundle.js"></script></body></html>' > "$tmp/index.html"
out=$("$chrome" --headless=new --disable-gpu --window-size=1400,800 --virtual-time-budget=2000 --dump-dom "file://$tmp/index.html" 2>/dev/null |
  sed -n '/<pre id="result">/,/<\/pre>/p' | sed -e 's/.*<pre id="result">//' -e 's/<[^>]*>//g' -e 's/&gt;/>/g')
echo "$out"
[ -n "$out" ] || { echo "no result: the page did not run"; exit 1; }
if echo "$out" | grep -q -v '^PASS'; then exit 1; fi
