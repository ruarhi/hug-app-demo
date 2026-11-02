#!/bin/bash
# Lay a fresh proto web build over this demo, keeping the demo's own extras.
#   bash demo-refresh.sh <www dir from proto-build.sh> [hug-app-demo checkout, default: this folder]
set -euo pipefail
WWW="$1"; DEMO="${2:-$(cd "$(dirname "$0")" && pwd)}"
FALLBACK="$(mktemp)"
# demo.css is built INTO index.html: a separate file failed to load once and the phone lost its spacing.
# The demo's storage fallback = every line of its proto-seed.js above the build's own seed.
awk '/PROTO BUILD ONLY/{exit} {print}' "$DEMO/assets/proto-seed.js" > "$FALLBACK"
[ -s "$FALLBACK" ] || { echo "no storage fallback found in $DEMO/assets/proto-seed.js"; exit 1; }
# Replace everything except the demo-only files.
( cd "$DEMO" && find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .nojekyll ! -name netlify.toml \
    ! -name README.md ! -name demo.css ! -name demo-refresh.sh -exec rm -rf {} + )
cp -R "$WWW/." "$DEMO/"
# demo.css after styles.css, and the fallback on top of the seed.
python3 - "$DEMO" "$FALLBACK" <<'PY'
import re, sys
demo, fb = sys.argv[1], sys.argv[2]
p = demo + '/index.html'; s = open(p).read()
m = re.search(r'<link rel="stylesheet" href="styles\.css\?v=[^"]*">', s)
assert m, 'styles.css link not found'
link = '\n  <style id="demo-css">/* DEMO SITE: demo.css, built into the page so the phone can never lose its spacing. Edit demo.css, then run demo-refresh. */\n' + open(demo + '/demo.css').read().rstrip() + '\n  </style>'
s = s[:m.end()] + link + s[m.end():]; open(p, 'w').write(s)
p = demo + '/assets/proto-seed.js'; seed = open(p).read()
open(p, 'w').write(open(fb).read() + seed)
print('demo extras re-applied')
PY
rm -f "$FALLBACK"
grep -c 'id="demo-css"' "$DEMO/index.html"
