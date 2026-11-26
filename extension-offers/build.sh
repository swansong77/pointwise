#!/usr/bin/env bash
# Builds the unpacked extension into extension-offers/dist (load it from chrome://extensions with Developer mode on).
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist
npx --yes -p typescript@5 tsc -p tsconfig.json
cp manifest.json popup.html dist/
echo "Built extension-offers/dist"
