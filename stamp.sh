#!/bin/sh
# Stamp the build id into build.js + version.json. Run this before each commit/deploy so the
# in-page version badge can tell whether the browser is showing the latest deployed build.
DIR=$(cd "$(dirname "$0")" && pwd)
EPOCH=$(date -u +%s)
HUMAN=$(date -u +"%Y-%m-%d %H:%M UTC")
printf 'window.PR_BUILD={build:%s,built:"%s"};\n' "$EPOCH" "$HUMAN" > "$DIR/build.js"
printf '{"build":%s,"built":"%s"}\n' "$EPOCH" "$HUMAN" > "$DIR/version.json"
echo "stamped build $EPOCH ($HUMAN)"
