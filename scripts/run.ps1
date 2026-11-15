param(
    [ValidateSet("build", "test", "replay")]
    [string] $Task = "build"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pixiRoot = Join-Path $root ".pixi"
$pixi = Join-Path $pixiRoot "bin\pixi.exe"
if (-not (Test-Path -LiteralPath $pixi)) {
    throw "Local Pixi is missing. Run scripts/bootstrap.ps1 first."
}
$env:PIXI_HOME = Join-Path $pixiRoot "home"
$env:PIXI_CACHE_DIR = Join-Path $pixiRoot "cache"
Push-Location $root
try {
    if ($Task -eq "replay") { & $pixi run --locked --environment web-check replay }
    else { & $pixi run $Task }
    if ($LASTEXITCODE -ne 0) { throw "Pixi task '$Task' failed ($LASTEXITCODE)" }
} finally { Pop-Location }
