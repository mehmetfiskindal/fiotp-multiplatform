param(
  [ValidateSet('i486','armv7hl','aarch64')][string]$Architecture = 'aarch64',
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $project
try {
  & node patches/geastack-sailfish-build.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & (Join-Path $project 'node_modules/@geastack/linux/targets/sailfish-os/build-sailfish-os.ps1') -AppDirectory $project -Architecture $Architecture -PrepareOnly:$PrepareOnly
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
