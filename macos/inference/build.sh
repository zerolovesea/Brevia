#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cache="$PWD/dist/native/inference-sources"
destination="$PWD/dist/native/engines"
mkdir -p "$cache"
output=$(mktemp -d "$cache/engines.XXXXXX")
trap 'rm -rf "$output"' EXIT
download() {
  local url=$1 file=$2 digest=$3
  if [[ ! -f "$file" ]] || [[ "$(shasum -a 256 "$file" | cut -d ' ' -f 1)" != "$digest" ]]; then
    curl --fail --location --proto '=https' --retry 2 --retry-all-errors --connect-timeout 20 --max-time 300 --retry-max-time 900 "$url" -o "$file"
  fi
  [[ "$(shasum -a 256 "$file" | cut -d ' ' -f 1)" == "$digest" ]] || exit 1
}
download 'https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/miniaudio.h' "$cache/miniaudio.h" 7e4f3f13c8fe66df2080ac3dd12a89193e3c2463cb7f067c798abd7331cd8ee6
download 'https://raw.githubusercontent.com/nothings/stb/f0569113c93ad095470c54bf34a17b36646bbbb5/stb_vorbis.c' "$cache/stb_vorbis.c" 4c7cb2ff1f7011e9d67950446b7eb9ca044f2e464d76bfbb0b84dd2e23e65636
mkdir -p "$cache/extras/decoders/libopus" "$cache/opusfile-build"
download 'https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/extras/decoders/libopus/miniaudio_libopus.h' "$cache/extras/decoders/libopus/miniaudio_libopus.h" 2d15bc4acb91a9775babe25527654f75ecc970ecdb05cdf2382a43d8e3eaed97
download 'https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/extras/decoders/libopus/miniaudio_libopus.c' "$cache/extras/decoders/libopus/miniaudio_libopus.upstream.c" d58586494c65a4604c7b3d2e0a78851a9ed4ec8a56b68b300aa423a96c9e16ac
cp "$cache/extras/decoders/libopus/miniaudio_libopus.upstream.c" "$cache/extras/decoders/libopus/miniaudio_libopus.c"
patch "$cache/extras/decoders/libopus/miniaudio_libopus.c" < macos/inference/opus-stereo.patch
download 'https://downloads.xiph.org/releases/ogg/libogg-1.3.6.tar.xz' "$cache/libogg-1.3.6.tar.xz" 5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061
download 'https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz' "$cache/opus-1.6.1.tar.gz" 6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1
download 'https://downloads.xiph.org/releases/opus/opusfile-0.12.tar.gz' "$cache/opusfile-0.12.tar.gz" 118d8601c12dd6a44f52423e68ca9083cc9f2bfe72da7a8c1acb22a80ae3550b
for archive in libogg-1.3.6.tar.xz opus-1.6.1.tar.gz opusfile-0.12.tar.gz; do
  directory=${archive%.tar.*}
  if [[ ! -d "$cache/$directory" ]]; then tar -xf "$cache/$archive" -C "$cache"; fi
done
cmake -S "$cache/libogg-1.3.6" -B "$cache/ogg-build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 -DCMAKE_OSX_ARCHITECTURES=arm64 -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DINSTALL_DOCS=OFF
cmake --build "$cache/ogg-build" --parallel 8
cmake -S "$cache/opus-1.6.1" -B "$cache/opus-build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 -DCMAKE_OSX_ARCHITECTURES=arm64 -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF -DBUILD_TESTING=OFF -DOPUS_DRED=OFF -DOPUS_OSCE=OFF -DOPUS_DEEP_PLC=OFF
cmake --build "$cache/opus-build" --parallel 8
# opusfile 仅构建本地流解析，HTTP/TLS 组件不进入应用。
opus_includes=(-I "$cache/opusfile-0.12/include" -I "$cache/opus-1.6.1/include" -I "$cache/libogg-1.3.6/include" -I "$cache/ogg-build/include")
for source in info internal opusfile stream; do
  xcrun clang -c -O2 -mmacosx-version-min=14.0 -DOP_HAVE_LRINTF -DOP_HAVE_FSEEKO "${opus_includes[@]}" "$cache/opusfile-0.12/src/$source.c" -o "$cache/opusfile-build/$source.o"
done
xcrun clang -c -O2 -mmacosx-version-min=14.0 "${opus_includes[@]}" "$cache/extras/decoders/libopus/miniaudio_libopus.c" -o "$cache/opusfile-build/miniaudio_libopus.o"
xcrun libtool -static -o "$cache/opusfile-build/libopusfile.a" "$cache/opusfile-build/"*.o
sherpa=sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts-lib
download "https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/$sherpa.tar.bz2" "$cache/sherpa.tar.bz2" ac5594ad237db56ec4a6c4b3fc48700441b33a07bb71c235f35530a52a93f2e3
if [[ ! -d "$cache/$sherpa" ]]; then tar -xjf "$cache/sherpa.tar.bz2" -C "$cache"; fi
mkdir -p "$cache/sherpa-headers/sherpa-onnx/c-api"
download 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v2.0.1/sherpa-onnx/c-api/c-api.h' "$cache/sherpa-headers/sherpa-onnx/c-api/c-api.h" 5698f38ba09ad2bdf085c56a6cbbd7741acf15e25f4ce5c7097b9702cadf437f
llama_commit=e3546c7948e3af463d0b401e6421d5a4c2faf565
download "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/$llama_commit" "$cache/llama-native.tar.gz" f53842f1e5c1dd7a92776576cc4add2e381d0c1b345793e89459489019b9f61a
llama="$cache/llama.cpp-$llama_commit"
if [[ ! -d "$llama" ]]; then tar -xzf "$cache/llama-native.tar.gz" -C "$cache"; fi
cmake -S "$llama" -B "$cache/llama-native-build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 -DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_NATIVE=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_OPENMP=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_BUILD_COMMON=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TOOLS=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_CURL=OFF
cmake --build "$cache/llama-native-build" --parallel 8
cp -R "$cache/$sherpa/lib/"*.dylib "$output/"
cp -R "$cache/llama-native-build/bin/"*.dylib "$output/"
for library in "$output/"*.dylib; do
  [[ -L "$library" ]] && continue
  install_name_tool -id "@rpath/$(basename "$library")" "$library"
  while read -r dependency; do
    case "$dependency" in
      /usr/lib/*|/System/*) ;;
      *)
        target="$output/$(basename "$dependency")"
        while [[ -L "$target" ]]; do target="$(dirname "$target")/$(readlink "$target")"; done
        if [[ ! -f "$target" ]]; then
          echo "Missing native dependency: $dependency" >&2
          exit 1
        fi
        # Hardened Runtime 要求请求的 leaf 名与加载库 install name 完全相同。
        install_name_tool -change "$dependency" "@rpath/$(basename "$target")" "$library"
        ;;
    esac
  done < <(otool -L "$library" | tail -n +3 | awk '{print $1}')
  has_loader_path=false
  while read -r search_path; do
    case "$search_path" in
      @loader_path) has_loader_path=true ;;
      /usr/lib/*|/System/*|@*) ;;
      *) install_name_tool -delete_rpath "$search_path" "$library" ;;
    esac
  done < <(otool -l "$library" | awk '/cmd LC_RPATH/{getline;getline; print $2}')
  if [[ "$has_loader_path" == false ]]; then
    install_name_tool -add_rpath '@loader_path' "$library"
  fi
done
xcrun clang++ -std=c++17 -O2 -mmacosx-version-min=14.0 -I "$cache/sherpa-headers" -I "$llama/vendor" -I "$llama/common" -I "$llama/include" -I "$llama/ggml/include" macos/inference/NativeInference.cpp macos/inference/AudioDecode.cpp -I "$cache" -L "$output" -lsherpa-onnx-c-api -lllama -lggml -lggml-base "$cache/opusfile-build/libopusfile.a" "$cache/opus-build/libopus.a" "$cache/ogg-build/libogg.a" -Wl,-rpath,@executable_path -o "$output/brevia-inference"
swift package --package-path macos/inference resolve
alignment=macos/inference/.build/checkouts/mlx-audio-swift/Sources/MLXAudioSTT/Models/Nemo/NemoAlignment.swift
if ! grep -q '"tokens":' "$alignment"; then
  patch -p1 -d macos/inference/.build/checkouts/mlx-audio-swift < macos/inference/mlx-alignment.patch
fi
if ! grep -q 'public let initialPrompt:' macos/inference/.build/checkouts/mlx-audio-swift/Sources/MLXAudioSTT/Generation.swift; then
  patch -p1 -d macos/inference/.build/checkouts/mlx-audio-swift < macos/inference/mlx-whisper-prompt.patch
fi
swift build --package-path macos/inference -c release
swift_output=$(swift build --package-path macos/inference -c release --show-bin-path)
cp "$swift_output/brevia-mlx" "$output/"
find "$swift_output" -maxdepth 1 -name '*.bundle' -exec cp -R {} "$output/" \;
xcrun swift-stdlib-tool --copy --scan-executable "$output/brevia-mlx" --destination "$output" --platform macosx
# Xcode 给工具链插入绝对搜索路径；可移动产物只保留系统目录和同级资源。
while read -r search_path; do
  case "$search_path" in
    /usr/lib/*|/System/*|@*) ;;
    *) install_name_tool -delete_rpath "$search_path" "$output/brevia-mlx" ;;
  esac
done < <(otool -l "$output/brevia-mlx" | awk '/cmd LC_RPATH/{getline;getline; print $2}')
strip -S -x "$output/brevia-mlx" "$output/brevia-inference"
mkdir -p "$output/licenses"
cp "$llama/LICENSE" "$output/licenses/llama.cpp-LICENSE"
download 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT' "$output/licenses/nlohmann-LICENSE" 46a65cffd1ea955132d95a8dd921640714a8d6b537d2e4e482d31145ae95b603
cp "$llama/common/base64.hpp" "$output/licenses/base64-LICENSE"
cp "$cache/libogg-1.3.6/COPYING" "$output/licenses/libogg-LICENSE"
cp "$cache/opus-1.6.1/COPYING" "$output/licenses/opus-LICENSE"
cp "$cache/opusfile-0.12/COPYING" "$output/licenses/opusfile-LICENSE"
download 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v2.0.1/LICENSE' "$cache/sherpa-LICENSE" cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
download 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.28.2/LICENSE' "$cache/onnxruntime-LICENSE" 2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c
cp "$cache/sherpa-LICENSE" "$cache/onnxruntime-LICENSE" "$output/licenses/"
node macos/inference/licenses.cjs "$cache" "$output/licenses"
for library in "$output/"*.dylib; do
  [[ -L "$library" ]] || codesign --force --sign - "$library"
done
codesign --force --sign - "$output/brevia-inference"
codesign --force --sign - "$output/brevia-mlx"
rm -rf "$destination"
mv "$output" "$destination"
