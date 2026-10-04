# FiOTP on Sailfish OS (aarch64)

This target builds a native SDL2 Sailfish RPM from the GeaStack TypeScript UI. It has been prepared for Sailfish OS 5.1.0.11 and an aarch64 phone. The Sailfish SDK build engine (Docker Desktop on Windows), Node.js 20.19+, and the `SailfishOS-5.1.0.11-aarch64` SDK target are required. The build links `maliit-glib` for Sailfish keyboard input.

On Windows, from this repository:

```powershell
npm ci
npm run build:sailfish
```

The RPM is written under `.gea-sailfish/build/fiotp-gea-aarch64/project/RPMS/`. The package name is `harbour-gea-fiotp-gea`. The first stage runs Vite and GeaStack code generation on Windows; Sailfish SDK then cross-compiles and packages the native binary. The build includes FiOTP's OpenSSL vault host and its JSON header. Source generation alone can be checked with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-sailfish.ps1 -PrepareOnly
```

To install a built RPM on a device with Developer Mode and SSH enabled, copy it to the phone, then install it there:

```powershell
scp .gea-sailfish/build/fiotp-gea-aarch64/project/RPMS/*.aarch64.rpm defaultuser@PHONE_IP:/home/defaultuser/
ssh defaultuser@PHONE_IP
devel-su pkcon install-local /home/defaultuser/harbour-gea-fiotp-gea-*.aarch64.rpm
```

The launcher appears as **FiOTP**. The app runs fullscreen and uses a 2x CSS pixel density for phone layouts. It stores its encrypted vault under `$XDG_DATA_HOME/com.fiskindal/fiotp/kasa.json` (or `~/.local/share/com.fiskindal/fiotp/kasa.json`), a Sailjail-writable application directory. Text fields use the Sailfish Maliit keyboard.

On Sailfish, creating a vault selects the default application data path automatically. Opening an existing vault uses that same path; copy a vault file there before opening it. A phone file picker is not yet available, so choosing arbitrary vault or backup files requires a future integration. Manual `otpauth://` entry is supported; camera QR scanning is unavailable in this native target.
