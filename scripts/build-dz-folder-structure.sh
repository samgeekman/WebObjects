#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-public/data/objects.min.json}"
OUT_ROOT="${2:-dz}"

if [[ ! -f "$SRC" ]]; then
  echo "Source file not found: $SRC" >&2
  exit 1
fi

mkdir -p "$OUT_ROOT"
count=0
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  # Keep only DayZ-style paths. If path already starts with dz, use as-is under root.
  mkdir -p "$OUT_ROOT/$p"
  : > "$OUT_ROOT/$p/.gitkeep"
  count=$((count+1))
done < <(jq -r '.[].path // empty' "$SRC" | sed 's#\\#/#g' | sed 's#^/*##; s#/*$##' | awk 'length>0' | sort -u)

echo "Created/updated $count folders under $OUT_ROOT from $SRC"
