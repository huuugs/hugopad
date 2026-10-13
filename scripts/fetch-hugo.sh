#!/usr/bin/env bash
# Cross-compile Hugo for Android ABIs and package as jniLibs/<abi>/libhugo.so
# Primary: CGO (extended, supports SCSS themes) with the Android NDK toolchain.
# Fallback: pure Go static build (standard Hugo, no libsass).
set -euo pipefail
cd "$(dirname "$0")/.."

HUGO_VERSION="${HUGO_VERSION:-v0.139.4}"
HUGO_EXTENDED="${HUGO_EXTENDED:-1}"
API_LEVEL="${API_LEVEL:-21}"
OUT_DIR="android/app/src/main/jniLibs"

find_ndk() {
  local roots=("${ANDROID_HOME:-$ANDROID_SDK_ROOT}" "$HOME/Android/Sdk" "/usr/lib/android-sdk")
  for r in "${roots[@]}"; do
    [ -d "$r/ndk" ] || continue
    local best=""
    for d in "$r"/ndk/*; do
      [ -d "$d" ] && best="$d"
    done
    if [ -n "$best" ]; then echo "$best"; return 0; fi
  done
  return 1
}

ensure_ndk() {
  local n
  if n="$(find_ndk)"; then echo "$n"; return 0; fi
  local sm="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/cmdline-tools/latest/bin/sdkmanager"
  [ -x "$sm" ] || return 1
  echo ">> NDK not found, installing via sdkmanager (needed for Hugo extended)…" >&2
  yes | "$sm" "ndk;${NDK_VERSION:-27.0.12077973}" >/dev/null 2>&1 || true
  find_ndk
}

# Note: `go install` refuses GOBIN for cross-compiled binaries;
# they land in $GOPATH/bin/<goos>_<goarch>/hugo instead.
hugo_out() { # $1=goos $2=goarch
  echo "$(go env GOPATH)/bin/${1}_${2}/hugo"
}

TRIPLE_arm64="aarch64-linux-android"
TRIPLE_arm="armv7a-linux-androideabi"
TRIPLE_amd64="x86_64-linux-android"

build_one() {
  local abi="$1" goarch="$2" goarm="${3:-}"
  local bin_dir="${OUT_DIR}/${abi}"
  mkdir -p "${bin_dir}" ".gobin/${abi}"
  local dest="${bin_dir}/libhugo.so"
  local target="github.com/gohugoio/hugo@${HUGO_VERSION}"

  if [ "${HUGO_EXTENDED}" = "1" ] && command -v go >/dev/null 2>&1; then
    if NDK="$(ensure_ndk)"; then
      local triple_var="TRIPLE_${goarch}"
      local triple="${!triple_var}"
      local host_tag="linux-x86_64"
      [ "$(uname -s)" = "Darwin" ] && host_tag="darwin-x86_64"
      local cc="${NDK}/toolchains/llvm/prebuilt/${host_tag}/bin/${triple}${API_LEVEL}-clang"
      local cxx="${cc}++"
      if [ -x "${cc}" ]; then
        echo ">> [${abi}] extended build (NDK cgo)"
        if env -u GOBIN CGO_ENABLED=1 GOOS=android GOARCH="${goarch}" CC="${cc}" CXX="${cxx}" \
            go install -tags extended "${target}"; then
          cp "$(hugo_out android "${goarch}")" "${dest}"
          chmod +x "${dest}"
          ls -lh "${dest}"
          return 0
        fi
        echo "!! [${abi}] extended build failed, falling back to standard build" >&2
      fi
    else
      echo "!! NDK not found, using standard build for ${abi}" >&2
    fi
  fi

  echo ">> [${abi}] standard build (GOOS=android, CGO_ENABLED=0)"
  # NOTE: must be GOOS=android (not linux): the Go stdlib avoids faccessat2
  # on android, which Android's seccomp blocks with SIGSYS on many devices.
  env -u GOBIN CGO_ENABLED=0 GOOS=android GOARCH="${goarch}" ${goarm:+GOARM=${goarm}} \
    go install "${target}"
  cp "$(hugo_out android "${goarch}")" "${dest}"
  chmod +x "${dest}"
}

build_one arm64-v8a arm64
build_one armeabi-v7a arm 7
build_one x86_64 amd64

echo ">> done:"
find "${OUT_DIR}" -name 'libhugo.so' -exec ls -lh {} \;
