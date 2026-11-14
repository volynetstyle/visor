$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gradle = Join-Path $root ".pixi\tools\gradle-9.6.0\bin\gradle.bat"
if (-not (Test-Path -LiteralPath $gradle)) {
    throw "Local Gradle is missing. Run scripts/bootstrap.ps1 first."
}
$env:GRADLE_USER_HOME = Join-Path $root ".gradle-user-home"
$env:npm_config_cache = Join-Path $root ".npm-cache"
$projectSdk = Join-Path $root ".android-sdk"
if (Test-Path -LiteralPath $projectSdk) {
    $env:ANDROID_HOME = $projectSdk
    $env:ANDROID_SDK_ROOT = $projectSdk
} elseif (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (Test-Path -LiteralPath $sdk) { $env:ANDROID_HOME = $sdk }
}
Push-Location $root
try {
    Push-Location (Join-Path $root "web")
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "Web build failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
    # Never install SDK packages into a shared SDK as a side effect of this command.
    $sdkDownload = if (Test-Path -LiteralPath $projectSdk) { "true" } else { "false" }
    & $gradle --no-daemon "-Pandroid.builder.sdkDownload=$sdkDownload" assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Android build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
