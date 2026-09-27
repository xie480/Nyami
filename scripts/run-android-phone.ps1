[CmdletBinding()]
param(
    [string]$DeviceId
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localProperties = Join-Path $repoRoot 'android/local.properties'

if (-not (Test-Path -LiteralPath $localProperties)) {
    throw "找不到 Android SDK 配置文件：$localProperties"
}

$sdkLine = Get-Content -LiteralPath $localProperties |
    Where-Object { $_ -match '^\s*sdk\.dir\s*=' } |
    Select-Object -First 1

if (-not $sdkLine) {
    throw "android/local.properties 中没有配置 sdk.dir。"
}

$sdkRoot = ($sdkLine -replace '^\s*sdk\.dir\s*=\s*', '').Trim()
$sdkRoot = $sdkRoot.Replace('\\', '\').Replace('/', '\')
$adb = Join-Path $sdkRoot 'platform-tools/adb.exe'
$reactNativeCli = Join-Path $repoRoot 'node_modules/.bin/react-native.cmd'

if (-not (Test-Path -LiteralPath $adb)) {
    throw "找不到 adb：$adb。请检查 android/local.properties 中的 sdk.dir。"
}

if (-not (Test-Path -LiteralPath $reactNativeCli)) {
    throw "找不到 React Native CLI：$reactNativeCli。请先在项目根目录安装 npm 依赖。"
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:PATH = "$(Join-Path $sdkRoot 'platform-tools');$env:PATH"

$previousErrorActionPreference = $ErrorActionPreference
try {
    # Windows PowerShell 5.1 treats native stderr as an error record; adb writes
    # normal daemon startup messages there, so rely on its exit code instead.
    $ErrorActionPreference = 'Continue'
    $deviceLines = @(& $adb devices 2>&1)
    $adbDevicesExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($adbDevicesExitCode -ne 0) {
    throw "adb devices 执行失败：$($deviceLines -join [Environment]::NewLine)"
}

$devices = @(
    foreach ($line in $deviceLines) {
        if ($line -match '^\s*(\S+)\s+(device|unauthorized|offline)\s*$') {
            [pscustomobject]@{
                Id    = $Matches[1]
                State = $Matches[2]
            }
        }
    }
)

$readyDevices = @($devices | Where-Object { $_.State -eq 'device' })
if ($DeviceId) {
    $selectedDevice = $readyDevices | Where-Object { $_.Id -eq $DeviceId } | Select-Object -First 1
    if (-not $selectedDevice) {
        $states = if ($devices.Count -gt 0) {
            ($devices | ForEach-Object { "$($_.Id) [$($_.State)]" }) -join ', '
        } else {
            '没有检测到设备'
        }
        throw "设备 $DeviceId 未处于已授权状态。当前设备：$states。请解锁手机并允许 USB 调试。"
    }
} elseif ($readyDevices.Count -eq 1) {
    $selectedDevice = $readyDevices[0]
} elseif ($readyDevices.Count -gt 1) {
    $ids = ($readyDevices | ForEach-Object { $_.Id }) -join ', '
    throw "检测到多台已授权设备：$ids。请指定设备，例如：npm run android:phone -- -DeviceId <序列号>"
} else {
    $states = if ($devices.Count -gt 0) {
        ($devices | ForEach-Object { "$($_.Id) [$($_.State)]" }) -join ', '
    } else {
        '没有检测到设备'
    }
    throw "没有已授权的 Android 手机（$states）。请连接 USB、开启开发者选项和 USB 调试，并在手机上允许此电脑调试。"
}

Write-Host "使用设备：$($selectedDevice.Id)"
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $adb -s $selectedDevice.Id reverse tcp:8081 tcp:8081
    $adbReverseExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($adbReverseExitCode -ne 0) {
    throw 'adb reverse 失败。请确认手机仍在线且 USB 调试已授权。'
}

Write-Host '正在构建并安装调试版；React Native CLI 会启动 Metro。'
Push-Location $repoRoot
try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $reactNativeCli run-android --deviceId $selectedDevice.Id
    $runAndroidExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($runAndroidExitCode -ne 0) {
        throw "Android 构建或安装失败，退出码：$runAndroidExitCode"
    }
} finally {
    if ($null -ne $previousErrorActionPreference) {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    Pop-Location
}
