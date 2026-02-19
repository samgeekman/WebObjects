#!/usr/bin/env bash
set -euo pipefail

SRC_DEFAULT="../samsdayzobjectfinder/static/api/v1/objects.full.json"
SRC="${1:-$SRC_DEFAULT}"
OUT="public/data/objects.min.json"

if [[ ! -f "$SRC" ]]; then
  echo "Source file not found: $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

jq '[
  .[]
  | {
      objectName,
      inGameName,
      category,
      path,
      imageUrl,
      bboxStatus,
      dimensionsSource,
      dimensionsVisual,
      bboxMinVisual,
      bboxMaxVisual
    }
  | . + {
      dimensionsVisual: (if (.dimensionsVisual | type) == "array" and (.dimensionsVisual | length) == 3 then .dimensionsVisual else [2.5,2.5,2.5] end),
      hasExactBox: (.bboxStatus == "matched" and (.bboxMinVisual | type) == "array" and (.bboxMaxVisual | type) == "array")
    }
]' "$SRC" > "$OUT"

echo "Wrote $OUT"
