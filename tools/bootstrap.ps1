$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pixiRoot = Join-Path $root ".pixi"
$pixi = Join-Path $pixiRoot "bin\pixi.exe"
$pixiUrl = "https://github.com/prefix-dev/pixi/releases/download/v0.81.0/pixi-x86_64-pc-windows-msvc.exe"
$pixiHash = "1b989b152ea13e881a641a112c7ea59c51818fd5ba84924c763b40b9b157dab9"
$gradle = Join-Path $pixiRoot "tools\gradle-9.6.0\bin\gradle.bat"
$gradleHash = "bbaeb2fef8710818cf0e261201dab964c572f92b942812df0c3620d62a529a01"

if (-not (Test-Path -LiteralPath $pixi)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $pixi) | Out-Null
    $download = "$pixi.download"
    try {
        Invoke-WebRequest -Uri $pixiUrl -OutFile $download
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant() -ne $pixiHash) {
            throw "Pixi checksum mismatch"
        }
        Move-Item -LiteralPath $download -Destination $pixi -Force
    } finally {
        Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $gradle)) {
    $archive = Join-Path $pixiRoot "gradle-9.6.0-bin.zip.download"
    try {
        Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-9.6.0-bin.zip" -OutFile $archive
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $gradleHash) {
            throw "Gradle checksum mismatch"
        }
        # Expand-Archive requires a .zip extension.
        $zip = Join-Path $pixiRoot "gradle-9.6.0-bin.zip"
        Move-Item -LiteralPath $archive -Destination $zip -Force
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $pixiRoot "tools") -Force
    } finally {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Join-Path $pixiRoot "gradle-9.6.0-bin.zip") -Force -ErrorAction SilentlyContinue
    }
}

$env:PIXI_HOME = Join-Path $pixiRoot "home"
$env:PIXI_CACHE_DIR = Join-Path $pixiRoot "cache"
Push-Location $root
try {
    & $pixi install --locked --all
    if ($LASTEXITCODE -ne 0) { throw "Pixi install failed ($LASTEXITCODE)" }
    $env:npm_config_cache = Join-Path $root ".npm-cache"
    & $pixi run --locked --environment web-check web-install
    if ($LASTEXITCODE -ne 0) { throw "Local web build tools install failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host "Environment ready. Build with: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 build"
