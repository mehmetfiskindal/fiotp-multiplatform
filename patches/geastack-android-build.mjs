import { existsSync, readFileSync, writeFileSync } from 'node:fs'

function patch(path, marker, replacements) {
  if (!existsSync(path)) {
    console.log(`Skipping GeaStack Android patch: ${path} not found`)
    return
  }
  let source = readFileSync(path, 'utf8')
  if (source.includes(marker)) return
  for (const [from, to] of replacements) {
    if (!source.includes(from)) {
      throw new Error(`Unsupported @geastack/android file ${path}: ${from.slice(0, 80)}`)
    }
    source = source.replace(from, to)
  }
  writeFileSync(path, source)
  console.log(`Patched ${path}`)
}

const buildScript = 'node_modules/@geastack/android/targets/android/build-android.sh'
patch(buildScript, 'APP_ROOT="$(pwd -P)"', [
  [
    `ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/targets/android"
# Packages come from this repo's own node_modules, the way node resolves them.
resolve_package() { node -e "process.stdout.write(require('fs').realpathSync('$ROOT_DIR/node_modules/$1'))" 2>/dev/null || true; }`,
    `ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/targets/android"
APP_ROOT="$(pwd -P)"
# FiOTP resolves GeaStack packages from the app that launches this script.
resolve_package() { node -e "process.stdout.write(require('fs').realpathSync('$APP_ROOT/node_modules/$1'))" 2>/dev/null || true; }`,
  ],
  [
    `echo "Cannot resolve \${_pair%%:*} — run \\\`npm install\\\` in $ROOT_DIR" >&2; exit 1; }`,
    `echo "Cannot resolve \${_pair%%:*} — run \\\`npm install\\\` in $APP_ROOT" >&2; exit 1; }`,
  ],
  [
    `BUILD_DIR="$ANDROID_DIR/build/$APP_ID"
DIST_DIR="$ANDROID_DIR/dist/$APP_ID"`,
    `BUILD_DIR="$APP_ROOT/.gea-android/build/$APP_ID"
DIST_DIR="$APP_ROOT/.gea-android/dist/$APP_ID"`,
  ],
  [
    `for (const source of manifest.gea?.nativeSources ?? []) {
  if (typeof source === 'string' && source.length > 0) console.log(source)
}`,
    `const skip = new Set(['native/fiotp_host.mm', 'native/fiotp_host_windows.cpp'])
for (const source of manifest.gea?.nativeSources ?? []) {
  if (typeof source !== 'string' || source.length === 0 || skip.has(source) || source.endsWith('.mm')) continue
  console.log(source)
}
console.log('native/fiotp_host_android.cpp')`,
  ],
  [
    `    "$NATIVE_TEMPLATE_DIR/$template.in" > "$JAVA_SRC_DIR/$PACKAGE_PATH/$template"
done`,
    `    "$NATIVE_TEMPLATE_DIR/$template.in" > "$JAVA_SRC_DIR/$PACKAGE_PATH/$template"
done
if [ "$PACKAGE_NAME" != "com.fiskindal.fiotp" ]; then
  echo "ERROR: FiOTP Android host is bound to package com.fiskindal.fiotp" >&2
  exit 1
fi
for extra in FiOtpJson.java FiOtpCrypto.java FiOtpVaultFiles.java FiOtpHost.java; do
  cp "$APP_DIR/native/android/$extra" "$JAVA_SRC_DIR/$PACKAGE_PATH/$extra"
done`,
  ],
  [
    `  echo "  <uses-permission android:name=\\"android.permission.INTERNET\\" />"
  echo "  <uses-permission android:name=\\"android.permission.ACCESS_NETWORK_STATE\\" />"`,
    `  echo "  <uses-permission android:name=\\"android.permission.INTERNET\\" />"
  echo "  <uses-permission android:name=\\"android.permission.ACCESS_NETWORK_STATE\\" />"
  echo "  <uses-permission android:name=\\"android.permission.CAMERA\\" />"
  echo "  <uses-feature android:name=\\"android.hardware.camera\\" android:required=\\"false\\" />"`,
  ],
  [
    `    <item name="android:windowFullscreen">true</item>`,
    `    <item name="android:windowFullscreen">false</item>`,
  ],
  [
    `find "$JAVA_SRC_DIR" "$GEN_DIR" -name '*.java' -print0 \\
  | xargs -0 javac -source 1.8 -target 1.8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" -d "$CLASSES_DIR"
find "$CLASSES_DIR" -name '*.class' -print0 \\`,
    `FIOTP_ZXING_JAR="$APP_ROOT/.gea-android/zxing-core-3.5.3.jar"
if [ ! -f "$FIOTP_ZXING_JAR" ]; then
  mkdir -p "$APP_ROOT/.gea-android"
  curl -fsSL --user-agent "fiotp-build" -o "$FIOTP_ZXING_JAR" "https://repo1.maven.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar"
fi
find "$JAVA_SRC_DIR" "$GEN_DIR" -name '*.java' -print0 \\
  | xargs -0 javac -source 1.8 -target 1.8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR:$FIOTP_ZXING_JAR" -d "$CLASSES_DIR"
(cd "$CLASSES_DIR" && jar xf "$FIOTP_ZXING_JAR")
rm -f "$CLASSES_DIR/module-info.class"
find "$CLASSES_DIR" -name '*.class' -print0 \\`,
  ],
])

const activity = 'node_modules/@geastack/android/targets/android/native/MainActivity.java.in'
patch(activity, 'FiOtpHost.attach(this);', [
  [
    `import android.app.Activity;
import android.os.Bundle;`,
    `import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;`,
  ],
  [
    `    getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);`,
    `    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);`,
  ],
  [
    `    setContentView(nativeView);
    nativeView.requestFocus();`,
    `    setContentView(nativeView);
    FiOtpHost.attach(this);
    nativeView.requestFocus();`,
  ],
  [
    `  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    );
  }`,
    `  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    FiOtpHost.onActivityResult(requestCode, resultCode, data);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    FiOtpHost.onRequestPermissionsResult(requestCode, permissions, grantResults);
  }

  private void hideSystemUi() {
  }`,
  ],
])

const view = 'node_modules/@geastack/android/targets/android/native/GeaNativeView.java.in'
patch(view, 'TYPE_TEXT_VARIATION_PASSWORD', [
  [
    `    input.setNodeId(id);
    input.setNativeText(value != null ? value : "");`,
    `    input.setNodeId(id);
    String inputKind = GeaNativeBridge.nativeAttribute(id, "type");
    int masked = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
    int plain = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS;
    int nextType = "password".equals(inputKind) ? masked : plain;
    if (input.getInputType() != nextType) input.setInputType(nextType);
    input.setNativeText(value != null ? value : "");`,
  ],
])

patch(buildScript, 'ANDROID_ICON_ATTRIBUTES[@]+', [
  [
    `for attr in "\${ANDROID_ICON_ATTRIBUTES[@]}"; do`,
    `for attr in \${ANDROID_ICON_ATTRIBUTES[@]+"\${ANDROID_ICON_ATTRIBUTES[@]}"}; do`,
  ],
])

patch(buildScript, 'android:versionCode', [
  [
    `echo "<manifest xmlns:android=\\"http://schemas.android.com/apk/res/android\\" package=\\"$PACKAGE_NAME\\">"`,
    `echo "<manifest xmlns:android=\\"http://schemas.android.com/apk/res/android\\" package=\\"$PACKAGE_NAME\\" android:versionCode=\\"\${GEA_ANDROID_VERSION_CODE:-2}\\" android:versionName=\\"\${GEA_ANDROID_VERSION_NAME:-0.1.0}\\">"`,
  ],
])
