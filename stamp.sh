#!/bin/sh
# Stamp the build id into build.js + version.json, and cache-bust every LOCAL script/style reference in the HTML
# files (?v=<build>) so a fresh deploy is always loaded — no stale cached JSX/JS/CSS even on a soft refresh or
# when navigating between pages. CDN/external (https://) URLs are left untouched. Run before each commit/deploy.
DIR=$(cd "$(dirname "$0")" && pwd)
EPOCH=$(date -u +%s)
HUMAN=$(date -u +"%Y-%m-%d %H:%M UTC")
printf 'window.PR_BUILD={build:%s,built:"%s"};\n' "$EPOCH" "$HUMAN" > "$DIR/build.js"
printf '{"build":%s,"built":"%s"}\n' "$EPOCH" "$HUMAN" > "$DIR/version.json"
for f in "$DIR"/*.html; do
  [ -f "$f" ] && perl -i -pe 's{((?:src|href)="(?!https?://)[^"?]+\.(?:js|jsx|css))(\?v=\d+)?"}{$1?v='"$EPOCH"'"}g' "$f"
done
echo "stamped build $EPOCH ($HUMAN) + cache-busted local refs in *.html"
