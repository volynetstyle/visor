param([switch] $Format)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$jar = Join-Path $root ".pixi\ktlint-1.8.0.jar"
$java = Join-Path $root ".pixi\envs\default\Library\lib\jvm\bin\java.exe"
if (-not (Test-Path -LiteralPath $jar) -or -not (Test-Path -LiteralPath $java)) {
    throw "Local ktlint or JDK is missing. Run tools/bootstrap.ps1 first."
}
$arguments = @("-jar", $jar, "platforms/android/src/**/*.kt", "*.gradle.kts", "platforms/android/*.gradle.kts")
if ($Format) { $arguments += "--format" }
else { $arguments += "--baseline=.ktlint-baseline.xml" }
Push-Location $root
try {
    & $java @arguments
    if ($LASTEXITCODE -ne 0) { throw "ktlint failed ($LASTEXITCODE)" }
} finally { Pop-Location }
