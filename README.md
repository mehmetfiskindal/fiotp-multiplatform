# FiOTP

FiOTP is an offline TOTP and HOTP authenticator for macOS, iOS, Linux, Windows, and Android. It stores accounts in a local vault encrypted with AES-256-GCM and generates verification codes on-device.

The application is built with [GeaStack](https://www.npmjs.com/package/@geastack/cli) using TypeScript and TSX. GeaStack compiles the interface from `src/index.tsx`. Platform host bridges provide native file, cryptography, clipboard, and camera integration where supported. Android uses the same interface: GeaStack compiles it to C++ and the NDK, then draws each node as a real Android view. There is no WebView and no separate Kotlin UI. The web target remains an interface preview.

## Platform build requirements

- Node.js and npm
- Xcode Command Line Tools (`xcode-select --install`) for Apple builds
- Raspberry Pi OS Bookworm or newer and the native dependencies listed in [LINUX.md](LINUX.md) for Linux builds
- Windows 10/11, Visual Studio Build Tools with the MSVC C++ toolset and Windows SDK, plus LLVM `clang-cl` and `lld-link` for Windows builds
- JDK 17 or newer, Android SDK platform and build-tools, Android NDK, and CMake for Android builds

## Installation

From the project directory, install the dependencies:

```sh
npm install
```

The install lifecycle applies the version-controlled macOS password-field patch in `patches/`. The patch enables native secure text entry while preserving GeaStack input events. If an upstream dependency change makes the patch incompatible, installation stops with an error so the change can be reviewed.

## Development and build

```sh
npm run dev          # Start the web interface preview
npm run check        # Run the TypeScript check
npm test             # Run OTP and native vault tests
npx gea inspect --json
npm run build:macos  # Build the macOS application
npm run build:windows  # Build the Windows application
npm run run:windows   # Build and launch the Windows application
npm run build:android # Build the native Android debug APK
```

The macOS application is generated at `dist/macos/fiotp-gea/FiOTP.app` and can be launched with:

```sh
open dist/macos/fiotp-gea/FiOTP.app
```

The Android APK is generated at `.gea-android/dist/fiotp-gea/fiotp-gea-debug.apk` and uses the package id `com.fiskindal.fiotp`. Android supports API 23 and newer. The debug build is signed with the Android debug key and defaults to version code 2 so it can replace the previous package without deleting its private files. `GEA_ANDROID_VERSION_CODE` and `GEA_ANDROID_VERSION_NAME` override that. The interface is the shared GeaStack application. The Android host stores the default encrypted vault in the app's private files as `kasa.json`, opens and exports other vault files through the system document picker, copies codes with the system clipboard, and scans QR codes with Camera2. The vault format matches the Apple, Linux, and Windows targets.

The Windows target uses GeaStack's native Win32 desktop renderer. Build it on Windows with `npm run build:windows`; run it with `npm run run:windows`. The executable is generated at `dist/windows/fiotp-gea/FiOTP.exe`. The Windows host stores its default encrypted vault under `%APPDATA%\FiOTP\kasa.json`, uses native Windows file dialogs and the system clipboard, and reads and writes the same encrypted vault format as the Apple and Linux targets. Camera QR scanning is not available in the initial Windows target; add accounts with an `otpauth://` URI or enter them manually.

The web target is intended for interface development and preview. It does not open or persist production vaults. Camera access and production vault workflows are available in the macOS, iOS, and Android applications.

`npm run build:macos` adds the camera usage description to the application bundle and applies an ad-hoc signature for local testing. Public distribution requires signing with a Developer ID certificate and notarization by Apple.

## Using FiOTP

1. On first launch, create a vault or select an existing encrypted vault file.
2. Unlock the vault with its master password. New vaults start empty and contain no sample accounts.
3. Add an account manually, paste an `otpauth://` URI, or scan a QR code with the camera. Google Authenticator migration QR codes are also supported.
4. Select a TOTP code to copy it. For HOTP accounts, use the counter control to advance to the next code.
5. Find accounts with search, categories, and favorites. Use **Vault & Backup** to export an encrypted backup, import a backup, or change the master password.

On macOS the default vault is `~/Library/Application Support/FiOTP Gea/kasa.json`; on Windows it is `%APPDATA%\FiOTP\kasa.json`. Linux uses `$XDG_DATA_HOME/fiotp/kasa.json` (or `~/.local/share/fiotp/kasa.json`). Android keeps the default vault in the app's private files as `kasa.json`. Another location can be selected in the application. The vault key is derived with PBKDF2-HMAC-SHA256. Writes are atomic, and the previous valid version is retained as a `.bak` recovery file. The vault cannot be opened without its master password, so keep the password and backups in a secure location. FiOTP locks the vault after five minutes of inactivity.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/App.tsx`, `src/stores/` | Interface and application state |
| `src/crypto/`, `src/services/` | OTP generation and encrypted vault operations |
| `native/` | Apple, Linux, Windows, and Android host integrations |
| `windows.json` | Windows native window configuration |
| `native/android/` | Android vault, document picker, clipboard, and QR camera bridge |
| `patches/` | GeaStack macOS password-field and Android build patches |
| `tests/`, `native/fiotp_host_test.mm` | OTP and native vault tests |

## License, branding, and security

The source code is distributed under the [MIT License](LICENSE). The **FiOTP** name, logo, icon, and product identity are reserved under the [trademark policy](TRADEMARKS.md); forks must use distinct product branding. Please follow [SECURITY.md](SECURITY.md) when reporting vulnerabilities. Do not include real vault files, OTP secrets, or passwords in issues or pull requests.
