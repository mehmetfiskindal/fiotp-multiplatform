import { existsSync, readFileSync, writeFileSync } from 'node:fs'

function patch(file, replacements) {
  if (!existsSync(file)) throw new Error(`Missing GeaStack Sailfish target: ${file}`)
  const original = readFileSync(file, 'utf8')
  let source = original
  for (const [before, after, alreadyPatchedMarker] of replacements) {
    if (source.includes(after)) continue
    if (alreadyPatchedMarker && source.includes(alreadyPatchedMarker)) continue
    if (!source.includes(before)) throw new Error(`Unsupported GeaStack Sailfish source in ${file}: ${before.slice(0, 80)}`)
    source = source.replace(before, after)
  }
  if (source !== original) writeFileSync(file, source)
}

const root = 'node_modules/@geastack/linux/targets/sailfish-os'
patch(`${root}/prepare.mjs`, [
  [
    `const coreRepo = path.resolve(coreArg || path.join(linuxRoot, '../core'))
const corePackage = path.join(coreRepo, 'packages/core')
const npmCore = path.join(linuxRoot, 'node_modules/@geastack/core')
const coreMetadata = path.join(corePackage, 'package.json')
if (!fs.existsSync(coreMetadata)) throw new Error(\`missing core package: \${coreMetadata}\`)
const checkoutVersion = JSON.parse(fs.readFileSync(coreMetadata, 'utf8')).version
const installedVersion = JSON.parse(fs.readFileSync(path.join(npmCore, 'package.json'), 'utf8')).version
if (!checkoutVersion || checkoutVersion !== installedVersion) {
  throw new Error(\`core version mismatch: npm @geastack/core \${installedVersion}, checkout \${checkoutVersion}. Use a core checkout matching the installed npm package, or install the matching npm version.\`)
}`,
    `const coreRepo = coreArg ? path.resolve(coreArg) : null
const npmCore = path.join(linuxRoot, 'node_modules/@geastack/core')
if (coreRepo) {
  const coreMetadata = path.join(coreRepo, 'packages/core/package.json')
  if (!fs.existsSync(coreMetadata)) throw new Error(\`missing core package: \${coreMetadata}\`)
  const checkoutVersion = JSON.parse(fs.readFileSync(coreMetadata, 'utf8')).version
  const installedVersion = JSON.parse(fs.readFileSync(path.join(npmCore, 'package.json'), 'utf8')).version
  if (checkoutVersion !== installedVersion) throw new Error(\`core version mismatch: \${installedVersion} / \${checkoutVersion}\`)
}`,
    `const coreRepo = coreArg ? path.resolve(coreArg) : null`,
  ],
  [
    `const npmCore = path.join(linuxRoot, 'node_modules/@geastack/core')`,
    `const npmCore = path.join(appDir, 'node_modules/@geastack/core')`,
  ],
  [
    `const source = path.join(coreRepo, 'packages', name)`,
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) : path.join(linuxRoot, 'node_modules/@geastack', name)`,
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) :`,
  ],
  [
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) : path.join(linuxRoot, 'node_modules/@geastack', name)`,
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) : path.join(appDir, 'node_modules/@geastack', name)`,
  ],
  [
    `path.join(linuxRoot, 'node_modules/@geastack/compiler/dist/cli.js')`,
    `path.join(appDir, 'node_modules/@geastack/compiler/dist/cli.js')`,
  ],
  [
    `path.join(linuxRoot, 'node_modules/@geastack/geatsc-plugin-gea/dist/index.js')`,
    `path.join(appDir, 'node_modules/@geastack/geatsc-plugin-gea/dist/index.js')`,
  ],
  [
    `const generated = path.join(here, 'generated', app.id)`,
    `const generated = path.join(appDir, '.gea-sailfish', 'generated', app.id)`,
  ],
  [
    `const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: linuxRoot })
if (result.status !== 0) process.exit(result.status || 1)`,
    `const result = spawnSync(process.execPath, args, {
  stdio: 'inherit', cwd: linuxRoot,
  env: { ...process.env, GEA_RPIOS_FONT_LATIN_EXTENDED: '1' },
})
if (result.status !== 0) process.exit(result.status || 1)

// geatsc currently treats declared app-native globals as unresolved. Bind the
// generated host calls to the C++ object supplied by app_native instead.
const generatedEntry = path.join(generated, 'index.cpp')
let nativeEntry = fs.readFileSync(generatedEntry, 'utf8')
const unresolvedHost = 'gea::host::detail::throwReferenceError<gea::CallableObject<std::string(std::string, std::string)>>()'
const hostCalls = nativeEntry.split(unresolvedHost).length - 1
if (hostCalls !== 2) throw new Error('expected two native host calls, found ' + hostCalls)
nativeEntry = nativeEntry.replaceAll(unresolvedHost, 'fiotpHostInvoke')
const availability = /bool (gea_body_fn_decl_[A-Za-z0-9_]+)\\(\\) \\{\\s*gea::Value::Tag v0;\\s*v0 = gea::Value::Tag::Undefined;\\s*return \\(v0 == gea::Value::Tag::Function\\);\\s*\\}/g
const matches = [...nativeEntry.matchAll(availability)]
if (matches.length !== 1) throw new Error('expected one native host availability check, found ' + matches.length)
nativeEntry = nativeEntry.replace(availability, 'bool $1() { return true; }')
nativeEntry = nativeEntry.replace('#include "gea/audio-worklet-runtime.h"', '#include "gea/audio-worklet-runtime.h"\\n#include "fiotp_host.h"')
fs.writeFileSync(generatedEntry, nativeEntry)`,
  ],
  [
    `const stage = path.join(here, 'build', \`\${app.id}-\${arch}\`, 'project')`,
    `const stage = path.join(appDir, '.gea-sailfish', 'build', \`\${app.id}-\${arch}\`, 'project')`,
  ],
  [
    `const allowedParent = path.resolve(here, 'build') + path.sep`,
    `const allowedParent = path.resolve(appDir, '.gea-sailfish', 'build') + path.sep`,
  ],
  [
    `copyTree(path.join(here, 'include'), path.join(stage, 'platform/include'))`,
    `copyTree(path.join(here, 'include'), path.join(stage, 'platform/include'))
copyTree(path.join(appDir, 'native/vendor'), path.join(stage, 'app_native/vendor'))
for (const name of ['fiotp_host_linux.cpp', 'fiotp_host.h']) fs.copyFileSync(path.join(appDir, 'native', name), path.join(stage, 'app_native', name))`,
  ],
  [
    `for (const name of ['fiotp_host_linux.cpp', 'fiotp_host.h']) fs.copyFileSync(path.join(appDir, 'native', name), path.join(stage, 'app_native', name))`,
    `for (const name of ['fiotp_host_linux.cpp', 'fiotp_host.h', 'sailfish_keyboard.cpp', 'sailfish_keyboard.h']) fs.copyFileSync(path.join(appDir, 'native', name), path.join(stage, 'app_native', name))`,
  ],
  [
    `const { includeFlags, cSources, cxxSources } = await import(pathToFileURL(path.join(coreRepo, 'packages/core/gea_sources.mjs')))`,
    `const { includeFlags, cSources, cxxSources } = await import(pathToFileURL(coreRepo ? path.join(coreRepo, 'packages/core/gea_sources.mjs') : path.join(npmCore, 'gea_sources.mjs')))`,
  ],
  [
    `cxx.push('framework/core/gea_app_entry.cpp')`,
    `cxx.push('framework/core/gea_app_entry.cpp')
cxx.push('app_native/fiotp_host_linux.cpp')`,
  ],
  [
    `cxx.push('app_native/fiotp_host_linux.cpp')`,
    `cxx.push('app_native/fiotp_host_linux.cpp')
cxx.push('app_native/sailfish_keyboard.cpp')`,
  ],
  [
    `const includes = ['platform/include', 'generated', ...includeFlags(env).map((s) => rel(s.slice(2)))]`,
    `const includes = ['platform/include', 'generated', 'app_native', 'app_native/vendor', ...includeFlags(env).map((s) => rel(s.slice(2)))]`,
  ],
  [
    `BuildRequires: pkgconfig(libcurl)\\n`,
    `BuildRequires: pkgconfig(libcurl)\\nBuildRequires: pkgconfig(openssl)\\n`,
  ],
  [
    `BuildRequires: pkgconfig(openssl)\\n`,
    `BuildRequires: pkgconfig(openssl)\\nBuildRequires: pkgconfig(maliit-glib)\\n`,
  ],
])

patch(`${root}/CMakeLists.txt`, [
  [`find_package(PkgConfig REQUIRED)`, `find_package(PkgConfig REQUIRED)
find_package(OpenSSL REQUIRED)`],
  [`pkg_check_modules(CURL REQUIRED IMPORTED_TARGET libcurl)`, `pkg_check_modules(CURL REQUIRED IMPORTED_TARGET libcurl)
pkg_check_modules(MALIIT REQUIRED IMPORTED_TARGET maliit-glib)`],
  [`  GEA_EMBEDDED_TTF_RUNTIME_FONTS=1`, `  GEA_EMBEDDED_TTF_RUNTIME_FONTS=1
  GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=1`, `FIOTP_SAILFISH=1`],
  [`  GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=1`, `  GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=1
  FIOTP_SAILFISH=1`, `FIOTP_SAILFISH=1`],
  [`  GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=1`, `  GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=0`],
  [`PkgConfig::SDL2 PkgConfig::CURL pthread m rt`, `PkgConfig::SDL2 PkgConfig::CURL OpenSSL::Crypto pthread m rt`, `PkgConfig::MALIIT`],
  [`PkgConfig::CURL OpenSSL::Crypto pthread`, `PkgConfig::CURL PkgConfig::MALIIT OpenSSL::Crypto pthread`],
])

patch(`${root}/main/sailfish_audio.cpp`, [
  [
    `void AudioSystem::stopPlayback() {}`,
    `void AudioSystem::stopPlayback() {}
void AudioSystem::flushPlayback() {}`,
  ],
])

patch('node_modules/@geastack/engine/rasterized_font.cpp', [
  [
    `constexpr int kRuntimeExtraGlyphs = 1;`,
    `constexpr int kRuntimeLatin1First = 0x00a0;
constexpr int kRuntimeLatin1Count = 0x60;
constexpr int kRuntimeTurkish[] = {0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f};
constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6;`,
    `kRuntimeSymbols`,
  ],
  [
    `constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6;`,
    `constexpr int kRuntimeSymbols[] = {0x2013, 0x2014, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026,
    0x2190, 0x2192, 0x2315, 0x2318, 0x25cf, 0x2605, 0x2699, 0x26a1, 0x2713, 0x2715};
constexpr int kRuntimeSymbolCount = sizeof(kRuntimeSymbols) / sizeof(kRuntimeSymbols[0]);
constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6 + kRuntimeSymbolCount;`,
  ],
  [
    `if (index == kRuntimeAsciiCount) return 0x00b0;`,
    `const int extra = index - kRuntimeAsciiCount;
if (extra >= 0 && extra < kRuntimeLatin1Count) return kRuntimeLatin1First + extra;
if (extra >= kRuntimeLatin1Count && extra < kRuntimeExtraGlyphs) return kRuntimeTurkish[extra - kRuntimeLatin1Count];`,
    `kRuntimeSymbols[extra`,
  ],
  [
    `if (extra >= kRuntimeLatin1Count && extra < kRuntimeExtraGlyphs) return kRuntimeTurkish[extra - kRuntimeLatin1Count];`,
    `if (extra >= kRuntimeLatin1Count && extra < kRuntimeLatin1Count + 6) return kRuntimeTurkish[extra - kRuntimeLatin1Count];
if (extra >= kRuntimeLatin1Count + 6 && extra < kRuntimeExtraGlyphs) return kRuntimeSymbols[extra - kRuntimeLatin1Count - 6];`,
  ],
])

patch(`${root}/main/sailfish_display.cpp`, [
  [
    `int window_flags = SDL_WINDOW_SHOWN | SDL_WINDOW_ALLOW_HIGHDPI | SDL_WINDOW_RESIZABLE;`,
    `// The canvas already uses the configured DPR. SDL's high-DPI flag can
// scale normalized finger coordinates again when logical size is enabled.
int window_flags = SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE;`,
  ],
])

patch(`${root}/main/sailfish_main.cpp`, [
  [`#include "touch.h"`, `#include "touch.h"
#include "sailfish_keyboard.h"`],
  [
    `bool changed = false;
\tfor (const char *p = utf8; *p; p++) {
\t\t// ASCII printable only — the raster pipeline's fonts cover ASCII.
\t\tif (*p >= 32 && *p < 127) {
\t\t\tnext.push_back(*p);
\t\t\tchanged = true;
\t\t}
\t}
\tif (!changed) return true;`,
    `if (!utf8 || !*utf8) return true;
\tnext.append(utf8);`,
  ],
  [
    `if (!next.empty()) {
\t\tnext.pop_back();`,
    `if (!next.empty()) {
\t\twhile (!next.empty() && (static_cast<unsigned char>(next.back()) & 0xc0) == 0x80) next.pop_back();
\t\tif (!next.empty()) next.pop_back();`,
  ],
  [`SDL_StartTextInput();`, `SDL_StartTextInput();
\tsailfish_keyboard_init(&appendTextToActiveInput, &applyBackspaceToActiveInput);`],
  [`\t\tpumpSdlEvents();`, `\t\tpumpSdlEvents();
\t\tsailfish_keyboard_pump();`],
  [`\t\tdispatchPendingEvents();`, `\t\tdispatchPendingEvents();
\t\tsailfish_keyboard_update(tree.activeInputId());`, `const int focusedInput = tree.activeInputId();`],
  [
    `sailfish_keyboard_update(tree.activeInputId());`,
    `const int focusedInput = tree.activeInputId();
\t\tsailfish_keyboard_update(focusedInput, focusedInput >= 0 ? tree.getAttribute(focusedInput, "type") : nullptr);`,
  ],
])

patch(`${root}/build-sailfish-os.ps1`, [
  [
    `$project = Join-Path $here "build/$((Get-Content (Join-Path $AppDirectory 'package.json') | ConvertFrom-Json).gea.id)-$Architecture/project"`,
    `$project = Join-Path $AppDirectory ".gea-sailfish/build/$((Get-Content (Join-Path $AppDirectory 'package.json') | ConvertFrom-Json).gea.id)-$Architecture/project"`,
  ],
])
