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

# Some launcher contexts set the JVM user.home to a sandbox account even when
# PowerShell is running as the Windows user. Keep Gradle's native caches aligned
# with that user's profile unless the caller explicitly configured a Gradle home.
if ([string]::IsNullOrWhiteSpace($env:GRADLE_USER_HOME)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        throw '无法确定 Windows 用户目录，且未配置 GRADLE_USER_HOME。'
    }
    $env:GRADLE_USER_HOME = Join-Path $env:USERPROFILE '.gradle'
}
Write-Host "Gradle 缓存目录：$env:GRADLE_USER_HOME"

# Ninja stores resolved header paths in a binary dependency index. A CMake
# reconfigure can update build.ninja while leaving that index tied to another
# Windows profile, causing FindFirstFileExA to fail on the next native build.
$expectedGradleCache = [System.IO.Path]::GetFullPath((Join-Path $env:GRADLE_USER_HOME 'caches'))
$expectedGradleCache = $expectedGradleCache.TrimEnd('\', '/').Replace('\', '/').ToLowerInvariant() + '/'
$nodeModulesRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'node_modules')).TrimEnd('\', '/') + '\'
$nativeCxxPatterns = @(
    Join-Path $repoRoot 'node_modules/*/android/.cxx'
    Join-Path $repoRoot 'node_modules/@*/*/android/.cxx'
)
$staleNinjaDepsFiles = @(
    foreach ($pattern in $nativeCxxPatterns) {
        $cxxDirectories = @(Get-ChildItem -Path $pattern -Directory -Force -ErrorAction SilentlyContinue)
        foreach ($cxxDirectory in $cxxDirectories) {
            Get-ChildItem -LiteralPath $cxxDirectory.FullName -Filter '.ninja_deps' -File -Recurse -Force -ErrorAction SilentlyContinue |
                ForEach-Object {
                    $indexPath = [System.IO.Path]::GetFullPath($_.FullName)
                    if (-not $indexPath.StartsWith($nodeModulesRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                        throw "拒绝清理工作区 node_modules 之外的 Ninja 缓存：$indexPath"
                    }

                    $indexText = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($indexPath)).ToLowerInvariant()
                    $cachePaths = [regex]::Matches($indexText, '[a-z]:[\\/][^\x00\r\n]{0,260}?[\\/]\.gradle[\\/]caches[\\/]')
                    foreach ($cachePath in $cachePaths) {
                        $normalizedCachePath = $cachePath.Value.Replace('\', '/').ToLowerInvariant()
                        if ($normalizedCachePath -ne $expectedGradleCache) {
                            $indexPath
                            break
                        }
                    }
                }
        }
    }
) | Sort-Object -Unique

foreach ($indexPath in $staleNinjaDepsFiles) {
    Remove-Item -LiteralPath $indexPath -Force
}
if ($staleNinjaDepsFiles.Count -gt 0) {
    Write-Host "已清理 $($staleNinjaDepsFiles.Count) 个引用其他 Gradle 缓存目录的 Ninja 依赖索引。"
}

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
