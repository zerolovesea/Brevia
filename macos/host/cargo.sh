#!/bin/bash
# Xcode 27.2 的 ld 27106.1 偶尔生成 dyld 拒绝加载的 Rust proc-macro dylib。
# 此版本改用 rustup 自带的 Mach-O linker。其他工具链沿用 Cargo 原配置。
set -euo pipefail
export MACOSX_DEPLOYMENT_TARGET=${MACOSX_DEPLOYMENT_TARGET:-14.0}
ld_version=$(xcrun ld -version_details 2>/dev/null | /usr/bin/plutil -extract version raw -o - - 2>/dev/null || true)
if [[ "$ld_version" != 27106.1 || -n "${RUSTFLAGS:-}${CARGO_ENCODED_RUSTFLAGS:-}" ]]; then
  exec cargo "$@"
fi

rustup_path=$(command -v rustup || true)
rustup_path=${rustup_path:-${CARGO_HOME:-$HOME/.cargo}/bin/rustup}
if [[ ! -x "$rustup_path" ]]; then
  echo 'Xcode ld 27106.1 requires the official rustup toolchain for this build. Install Rust with rustup, or select another Xcode with xcode-select.' >&2
  exit 1
fi
rustc_path=$("$rustup_path" which rustc)
cargo_path=$("$rustup_path" which cargo)
export PATH="$(dirname "$rustc_path"):$PATH"
sysroot=$("$rustc_path" --print sysroot)
host=$("$rustc_path" -vV | sed -n 's/^host: //p')
linker="$sysroot/lib/rustlib/$host/bin/gcc-ld/ld64.lld"
if [[ ! -x "$linker" ]]; then
  echo "This Rust toolchain does not include ld64.lld. Update rustup or select another Xcode." >&2
  exit 1
fi

# SDK 27 的 TAPI 架构可能超出当前 LLD 支持范围，验证系统/CLT 中可链接的 SDK。
# 首选显式 SDK，其次使用当前 Xcode，再尝试 macOS 14 及更高的已安装版本。
probe=$(mktemp -d)
trap '[[ ! -e "$probe/main" ]] || unlink "$probe/main"; rmdir "$probe"' EXIT
selected_sdk=$(xcrun --sdk macosx --show-sdk-path)
sdk_dir=$(dirname "$selected_sdk")
for sdk in "${SDKROOT:-}" "$selected_sdk" "$sdk_dir"/MacOSX[0-9]*.sdk /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk; do
  [[ -d "$sdk" ]] || continue
  sdk_version=$(/usr/bin/plutil -extract Version raw -o - "$sdk/SDKSettings.json" 2>/dev/null || true)
  [[ "${sdk_version%%.*}" =~ ^[0-9]+$ && "${sdk_version%%.*}" -ge 14 ]] || continue
  if printf '%s\n' 'int main(void) { return 0; }' | xcrun clang -isysroot "$sdk" "-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" "-fuse-ld=$linker" -x c - -o "$probe/main" 2>/dev/null; then
    export SDKROOT="$sdk" CARGO_ENCODED_RUSTFLAGS="-Clink-arg=-fuse-ld=$linker"
    echo "Using rustup ld64.lld and macOS SDK $sdk_version with Xcode ld $ld_version" >&2
    "$cargo_path" "$@"
    exit $?
  fi
done
echo 'No installed macOS SDK (14 or newer) can link with rustup ld64.lld. Install a compatible Command Line Tools SDK or select another Xcode.' >&2
exit 1
