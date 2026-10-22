#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${FL0W_REPO:-jackmuva/fl0w}"

MAX_WAIT_SECS=120
INTERVAL=30

normalize_version() {
  echo "${1#v}"
}

read_target_version() {
  grep -m1 '"version"' "$ROOT/package.json" \
    | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
}

fetch_latest_tag() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

TARGET="$(read_target_version)"
echo "Polling install every ${INTERVAL}s for up to ${MAX_WAIT_SECS}s (target version ${TARGET})..."

deadline=$(( SECONDS + MAX_WAIT_SECS ))
attempt=0

while (( SECONDS < deadline )); do
  attempt=$(( attempt + 1 ))
  remaining=$(( deadline - SECONDS ))
  echo "--- Attempt ${attempt} (${remaining}s left) ---"

  if ! (cd "$ROOT" && bun run download); then
    echo "Install failed; will retry if time remains." >&2
  fi

  tag="$(fetch_latest_tag || true)"
  if [[ -n "$tag" ]] && [[ "$(normalize_version "$tag")" == "$(normalize_version "$TARGET")" ]]; then
    echo "Release ${tag} matches package.json (${TARGET}); done."
    exit 0
  fi

  if [[ -n "$tag" ]]; then
    echo "Latest release is ${tag}; waiting for ${TARGET}."
  else
    echo "Could not resolve latest release tag."
  fi

  remaining=$(( deadline - SECONDS ))
  if (( remaining <= 0 )); then
    break
  fi

  step=$(( remaining < INTERVAL ? remaining : INTERVAL ))
  printf 'Retrying in %ds...\n' "$step"
  sleep "$step"
done

echo "Timed out after ${MAX_WAIT_SECS}s: latest release still does not match package.json (${TARGET})." >&2
exit 1
