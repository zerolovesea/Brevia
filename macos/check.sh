#!/bin/bash
# 检查原生宿主、全部推理引擎和录音收尾。所有会议和设备输入都使用临时数据。
set -euo pipefail
cd "$(dirname "$0")/.."
bundle=${1:-dist/native/image/Brevia.app}
if [[ ! -d "$bundle" ]]; then
  echo '请先运行 npm run dist:mac，或传入已构建的 Brevia.app 路径。' >&2
  exit 1
fi
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
macos/host/cargo.sh test --release --locked --manifest-path macos/host/Cargo.toml
xcrun swift-format lint --strict macos/audio/*.swift macos/inference/Package.swift macos/inference/Sources/main.swift
xcrun swiftc -D BREVIA_AUDIO_TEST -parse-as-library macos/audio/*.swift -o "$scratch/audio-test"
"$scratch/audio-test" > /dev/null
xcrun clang++ -std=c++17 -fobjc-arc -framework Foundation macos/inference/test-native-helpers.mm -o "$scratch/inference-test"
"$scratch/inference-test"
node --test macos/backend/test-*.cjs
codesign --verify --deep --strict "$bundle"
node macos/test-packaged-control.cjs "$bundle"
node macos/test-agent-app.cjs "$bundle"
node macos/host/smoke.cjs "$bundle"
