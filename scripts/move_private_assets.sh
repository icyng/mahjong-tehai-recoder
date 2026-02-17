#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$ROOT_DIR/../mj-private-assets}"

ASSETS=(
  "mj/models/tehai/dataset"
  "mj/models/tehai/runs_mj"
  "mj/models/tehai/showcase"
  "mj/models/tehai/yolov12l.pt"
  "mj/models/tehai/yolov12m.pt"
  "mj/models/tehai/yolov12n.pt"
  "mj/models/tehai/yolov12s.pt"
  "mj/models/tehai/yolov12x.pt"
  "hand_sample.png"
  "test.mp4"
)

echo "source: ${ROOT_DIR}"
echo "target: ${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

for rel in "${ASSETS[@]}"; do
  src="${ROOT_DIR}/${rel}"
  dst="${TARGET_DIR}/${rel}"
  if [[ ! -e "${src}" ]]; then
    continue
  fi
  mkdir -p "$(dirname "${dst}")"
  mv "${src}" "${dst}"
  echo "moved: ${rel}"
done

echo "done."
echo "runtime必須ファイル(best.pt)はリポジトリ側に残しています。"
