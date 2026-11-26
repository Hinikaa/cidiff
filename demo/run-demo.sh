#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$REPO_ROOT"
node dist/cli.js record \
  --out "$TMP_DIR/base.json" \
  --junit test/fixtures/junit-base.xml \
  --buildkit test/fixtures/buildkit-base.log \
  --steps test/fixtures/steps-base.json

node dist/cli.js record \
  --out "$TMP_DIR/head.json" \
  --junit test/fixtures/junit-head.xml \
  --buildkit test/fixtures/buildkit-head.log \
  --steps test/fixtures/steps-head.json

echo "$ cidiff compare --base base.json --head head.json --fail-on-regression"
set +e
node dist/cli.js compare \
  --base "$TMP_DIR/base.json" \
  --head "$TMP_DIR/head.json" \
  --fail-on-regression
status=$?
set -e
echo "Exit code: $status"
