#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-/tmp/mj-cli-public.git}"

if [[ -e "${OUT_DIR}" ]]; then
  echo "error: output already exists: ${OUT_DIR}" >&2
  exit 1
fi

echo "creating mirror clone: ${OUT_DIR}"
git clone --mirror "${ROOT_DIR}" "${OUT_DIR}"
cd "${OUT_DIR}"

if git filter-repo --help >/dev/null 2>&1; then
  echo "using git filter-repo"
  git filter-repo --force \
    --path result.png --path res_v08n.png --path res_v12m.png \
    --path hand_sample.png --path test.mp4 \
    --path mj/models/tehai/dataset --path mj/models/tehai/runs_mj --path mj/models/tehai/showcase \
    --path-glob 'mj/models/tehai/yolov12*.pt' \
    --invert-paths
else
  echo "git filter-repo not found. fallback to git filter-branch (slow)"
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --prune-empty --tag-name-filter cat \
    --tree-filter 'rm -rf mj/models/tehai/dataset mj/models/tehai/runs_mj mj/models/tehai/showcase; rm -f mj/models/tehai/yolov12*.pt result.png res_v08n.png res_v12m.png hand_sample.png test.mp4' \
    -- --all
  git for-each-ref --format='delete %(refname)' refs/original | git update-ref --stdin
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
fi

echo
echo "sanitized mirror created: ${OUT_DIR}"
echo "確認:"
echo "  git --git-dir='${OUT_DIR}' log --oneline --decorate -n 5"
echo "  git --git-dir='${OUT_DIR}' rev-list --objects --all | grep -E 'result.png|hand_sample.png|test.mp4|dataset|runs_mj|showcase|yolov12.*\\.pt' || true"
echo
echo "公開リポジトリへ反映する場合(強制push):"
echo "  git --git-dir='${OUT_DIR}' push --force --mirror <new-or-existing-remote-url>"
