$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gradle = Join-Path $root ".pixi\tools\gradle-9.6.0\bin\gradle.bat"
if (-not (Test-Path -LiteralPath $gradle)) {
    throw "Local Gradle is missing. Run tools/bootstrap.ps1 first."
}
$env:GRADLE_USER_HOME = Join-Path $root ".gradle-user-home"
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
    $sdkDownload = if (Test-Path -LiteralPath $projectSdk) { "true" } else { "false" }
    & $gradle --no-daemon "-Pandroid.builder.sdkDownload=$sdkDownload" testDebugUnitTest
    if ($LASTEXITCODE -ne 0) { throw "Android tests failed ($LASTEXITCODE)" }
} finally { Pop-Location }
