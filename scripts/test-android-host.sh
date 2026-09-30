#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/fiotp-android-host.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
javac --release 8 -d "$tmp" \
  "$root/native/android/FiOtpJson.java" \
  "$root/native/android/FiOtpCrypto.java" \
  "$root/native/android/FiOtpVaultFiles.java" \
  "$root/tests/android/FiOtpVaultTest.java"
java -cp "$tmp" com.fiskindal.fiotp.FiOtpVaultTest
