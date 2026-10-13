#!/usr/bin/env bash
# Prepare the Capacitor android project: create (if missing), copy native plugin,
# patch manifest (cleartext for 127.0.0.1 preview) and gradle (doNotStrip), then cap sync.
set -euo pipefail
cd "$(dirname "$0")/.."

PKG_DIR="android/app/src/main/java/com/hugopad/app"

if [ ! -f www/index.html ]; then
  echo "www/index.html missing. Run 'npm run build' first." >&2
  exit 1
fi

if [ ! -d android ]; then
  echo ">> npx cap add android"
  npx cap add android
fi

echo ">> copy native plugin sources"
mkdir -p "${PKG_DIR}"
cp android-plugin/java/com/hugopad/app/*.java "${PKG_DIR}/"

echo ">> MainActivity registers HugoNative"
cat > "${PKG_DIR}/MainActivity.java" <<'EOF'
package com.hugopad.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HugoNative.class);
        super.onCreate(savedInstanceState);
    }
}
EOF

MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q "usesCleartextTraffic" "${MANIFEST}"; then
  echo ">> patch AndroidManifest (cleartext)"
  sed -i 's|<application|<application\n            android:usesCleartextTraffic="true"|' "${MANIFEST}"
fi

GRADLE="android/app/build.gradle"
if ! grep -q "keepDebugSymbols" "${GRADLE}"; then
  echo ">> patch build.gradle (keep hugo binary unstripped)"
  sed -i '/^android {/a\    packaging { jniLibs { keepDebugSymbols += "**/*.so" } }' "${GRADLE}"
fi

echo ">> npx cap sync android"
npx cap sync android

chmod +x android/gradlew
echo ">> android project ready (jniLibs: run scripts/fetch-hugo.sh)"
