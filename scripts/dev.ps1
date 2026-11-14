param(
  [string]$Package = "io.volynetstyle.nightfield",
  [string]$Activity = ".MainActivity"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$candidates = @(
  (Join-Path $root ".android-sdk\platform-tools\adb.exe"),
  $(if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME "platform-tools\adb.exe" }),
  $(if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe" }),
  (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe")
)
$adb = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $adb) {
  $command = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($command) { $adb = $command.Source }
}
if (-not $adb) { throw "adb was not found. Install Android SDK Platform-Tools." }
& $adb reverse tcp:5173 tcp:5173
if ($LASTEXITCODE -ne 0) { throw "adb reverse failed ($LASTEXITCODE)" }
& $adb shell am force-stop $Package
if ($LASTEXITCODE -ne 0) { throw "Could not stop the app ($LASTEXITCODE)" }
& $adb shell am start -n "$Package/$Activity" --es url http://127.0.0.1:5173
if ($LASTEXITCODE -ne 0) { throw "Could not start the app ($LASTEXITCODE)" }
Write-Host "WebView pointed at Vite through adb reverse. Run '.\.pixi\bin\pixi.exe run web-dev' from the project root."
