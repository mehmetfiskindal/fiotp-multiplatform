#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
node "$PROJECT_ROOT/patches/geastack-android-build.mjs"
export GEA_ANDROID_PACKAGE_NAME="${GEA_ANDROID_PACKAGE_NAME:-com.fiskindal.fiotp}"
bash "$PROJECT_ROOT/node_modules/@geastack/android/targets/android/build-android.sh" fiotp-gea debug
