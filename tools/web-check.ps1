$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pixiRoot = Join-Path $root ".pixi"
$pixi = Join-Path $pixiRoot "bin\pixi.exe"
if (-not (Test-Path -LiteralPath $pixi)) {
    throw "Local Pixi is missing. Run tools/bootstrap.ps1 first."
}
$env:PIXI_HOME = Join-Path $pixiRoot "home"
$env:PIXI_CACHE_DIR = Join-Path $pixiRoot "cache"
Push-Location $root
try {
    & $pixi run --locked --environment web-check web-check
    if ($LASTEXITCODE -ne 0) { throw "Web performance invariants failed ($LASTEXITCODE)" }
} finally { Pop-Location }
