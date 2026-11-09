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
xcrun clang -fobjc-arc -fblocks -framework AppKit -framework WebKit -framework UniformTypeIdentifiers macos/host/test-capsule.m -o "$scratch/capsule-test"
"$scratch/capsule-test"
xcrun swift-format lint --strict macos/audio/*.swift macos/inference/Package.swift macos/inference/Sources/main.swift
xcrun swiftc -D BREVIA_AUDIO_TEST -parse-as-library macos/audio/*.swift -o "$scratch/audio-test"
"$scratch/audio-test" > /dev/null
xcrun clang++ -std=c++17 -I dist/native/inference-sources/llama.cpp-e3546c7948e3af463d0b401e6421d5a4c2faf565/vendor macos/inference/test-native-helpers.cpp -o "$scratch/inference-test"
"$scratch/inference-test"
sources=dist/native/inference-sources
xcrun clang++ -std=c++17 -O2 -I "$sources" macos/inference/test-audio-decode.cpp macos/inference/AudioDecode.cpp "$sources/opusfile-build/libopusfile.a" "$sources/opus-build/libopus.a" "$sources/ogg-build/libogg.a" -o "$scratch/decode-test"
"$scratch/decode-test"
codesign --verify --deep --strict "$bundle"
node macos/test-packaged-control.cjs "$bundle"
node macos/test-agent-app.cjs "$bundle"
node macos/host/smoke.cjs "$bundle"
