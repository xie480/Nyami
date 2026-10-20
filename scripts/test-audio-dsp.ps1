param(
    [string]$GradleCache = "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1",
    [string]$JavaHome = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'android\app\build\dsp-regression'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

# Use the Android project's JDK, which is compatible with Kotlin 1.9.
if (-not $JavaHome) {
    $javaSetting = Select-String -LiteralPath (Join-Path $projectRoot 'android\gradle.properties') `
        -Pattern '^org\.gradle\.java\.home=(.+)$' | Select-Object -First 1
    if ($javaSetting) {
        $JavaHome = $javaSetting.Matches[0].Groups[1].Value.Trim()
    } else {
        $JavaHome = $env:JAVA_HOME
    }
}
$javaExecutable = if ($JavaHome) { Join-Path $JavaHome 'bin\java.exe' } else { 'java' }

function Find-CachedJar([string]$group, [string]$artifact, [string]$version) {
    $dependencyPath = Join-Path $GradleCache "$group\$artifact\$version"
    $jar = Get-ChildItem -LiteralPath $dependencyPath -Recurse -File -Filter "$artifact-$version.jar" |
        Select-Object -First 1
    if (-not $jar) { throw "Missing cached dependency: $artifact $version in $GradleCache" }
    return $jar.FullName
}

$compilerJars = @(
    (Find-CachedJar 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '1.9.22'),
    (Find-CachedJar 'org.jetbrains.kotlin' 'kotlin-stdlib' '1.9.22'),
    (Find-CachedJar 'org.jetbrains.kotlin' 'kotlin-script-runtime' '1.9.22'),
    (Find-CachedJar 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10'),
    (Find-CachedJar 'org.jetbrains.intellij.deps' 'trove4j' '1.0.20200330'),
    (Find-CachedJar 'org.jetbrains' 'annotations' '13.0')
)
$classPath = $compilerJars -join [IO.Path]::PathSeparator
$sources = @(
    'android\app\src\main\java\com\bilimusic\audio\filter\BiquadFilter.kt',
    'android\app\src\main\java\com\bilimusic\audio\filter\RBJFilter.kt',
    'android\app\src\main\java\com\bilimusic\audio\FFTAnalyzer.kt',
    'android\app\src\main\java\com\bilimusic\audio\DSPAudioProcessor.kt',
    'android\app\src\main\java\com\bilimusic\audio\EqAudioProcessorAdapter.kt',
    'tests\manual\jvmStubs\AndroidLog.kt',
    'tests\manual\jvmStubs\ExoPlayerConstants.kt',
    'tests\manual\jvmStubs\AudioProcessor.kt',
    'tests\manual\DSPAudioProcessorRegression.kt'
) | ForEach-Object { Join-Path $projectRoot $_ }
$classes = Join-Path $outputDirectory 'classes'
& $javaExecutable -cp $classPath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect `
    -classpath $classPath -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw "Kotlin compilation failed: $LASTEXITCODE" }

# Read the product curves directly so the regression cannot drift from the app.
$presetSource = Get-Content -LiteralPath (Join-Path $projectRoot 'src\store\eqStore.ts') -Raw
$matches = [regex]::Matches($presetSource, "id:\s*'([^']+)'[^{}]*?graphicBands:\s*\[([^\]]+)\]", 'Singleline')
if ($matches.Count -ne 17) { throw "Expected 17 preset definitions, got $($matches.Count)" }
$presetFile = Join-Path $outputDirectory 'presets.csv'
$presetRows = $matches | ForEach-Object { $_.Groups[1].Value + ',' + ($_.Groups[2].Value -replace '\s', '') }
[IO.File]::WriteAllLines($presetFile, [string[]]$presetRows)
& $javaExecutable -cp ($classes + [IO.Path]::PathSeparator + $classPath) com.bilimusic.audio.DSPAudioProcessorRegression $presetFile
if ($LASTEXITCODE -ne 0) { throw "PCM regression failed: $LASTEXITCODE" }
