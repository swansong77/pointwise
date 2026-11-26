#!/usr/bin/env bash
# Builds the unpacked extension into extension/dist (load it from chrome://extensions → Developer mode → Load unpacked).
set -euo pipefail
cd "$(dirname "$0")"
TSC="../backend/node_modules/typescript/bin/tsc"
node ../backend/node_modules/.bin/ts-node --project ../backend/tsconfig.json --transpile-only scripts/gen-programs.ts > src/programs.generated.ts
node "$TSC" -p tsconfig.json
cp manifest.json popup.html popup.css dist/
mkdir -p dist/icons && cp icons/*.png dist/icons/
echo "built extension/dist"
