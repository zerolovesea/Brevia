#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node osg/source/medium.mjs
npx --yes open-screenshot-generator@0.1.34 render --config osg/osg.config.ts
npx --yes open-screenshot-generator@0.1.34 render --config osg/osg-medium.config.ts
npx --yes open-screenshot-generator@0.1.34 verify --config osg/osg.config.ts
npx --yes open-screenshot-generator@0.1.34 verify --config osg/osg-medium.config.ts
