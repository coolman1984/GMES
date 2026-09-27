#!/usr/bin/env sh
# Fetch the pinned Mizan version the end-to-end tests run against (black box, over HTTP).
# The pin is deliberate: a Mizan change that breaks the link must show up as a failing test
# when the pin is moved, not as a surprise at a customer.
set -eu
MIZAN_REPO="${MIZAN_REPO:-https://github.com/coolman1984/Accounting-sys.git}"
MIZAN_PIN="${MIZAN_PIN:-a23c749}"
DEST="${MIZAN_DIR:-$(dirname "$0")/../.cache/mizan}"
if [ ! -d "$DEST/.git" ]; then git clone --quiet "$MIZAN_REPO" "$DEST"; fi
git -C "$DEST" fetch --quiet origin
git -C "$DEST" checkout --quiet "$MIZAN_PIN"
(cd "$DEST" && npm ci --no-audit --no-fund --silent)
echo "Mizan $(git -C "$DEST" rev-parse --short HEAD) ready in $DEST"
