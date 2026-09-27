#!/usr/bin/env sh
# Fetch the pinned HR-System version the HR <-> manufacturing end-to-end test runs against
# (black box: the real Python application and its publisher, over HTTP).
set -eu
HR_REPO="${HR_REPO:-https://github.com/coolman1984/HR-System.git}"
HR_PIN="${HR_PIN:-0a9ac4ad1171d0f32133faea4a1cb56113be64dd}"
DEST="${HR_DIR:-$(dirname "$0")/../.cache/hr-system}"
if [ ! -d "$DEST/.git" ]; then git clone --quiet "$HR_REPO" "$DEST"; fi
git -C "$DEST" fetch --quiet origin '+refs/heads/*:refs/remotes/origin/*'
git -C "$DEST" checkout --quiet "$HR_PIN"
echo "HR-System $(git -C "$DEST" rev-parse --short HEAD) ready in $DEST"
