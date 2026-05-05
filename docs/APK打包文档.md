# 纯客户端方案- APK 打包完整流程

> 本文档专为**无公网后端**的 B 站音乐播放器项目设计，覆盖从代码自检到 APK 分发的全流程。
>
> **与公网后端方案的关键差异**会在每节明确标注，请重点关注。

---

## 一、纯客户端打包的特殊性

在开始具体步骤前，你必须理解纯客户端方案在打包发布上的几个关键差异：

| 维度 | 公网后端方案 | **纯客户端方案** |
|------|-------------|----------------|
| 配置项 | `apiBaseURL` 必须改为生产地址 | **无 API 地址配置** |
| 网络安全配置 | 测试时常需 cleartextTraffic | **严格 HTTPS only**（直连 B 站）|
| keystore 丢失影响 | 影响 APP 升级 | **同样致命**：APP 永远无法升级 |
| WBI 算法变更应对 | 改后端，用户无感知 | **必须发新版 APK** ⚠️ |
| 版本检查需求 | 可选 | **强烈推荐**（应对 B 站接口变更）|
| 上架应用商店 | 可以 | **不建议**（涉及第三方接口）|
| 分发渠道 | 应用商店 + APK | **APK 直发 / F-Droid** |
| 隐私优势 | 流量经第三方 | **直连，更隐私友好**（可作卖点）|

⚠️ 核心痛点：**B 站若更新 WBI 算法或接口，所有老版本会失效**。
解决方案见第九部分"版本升级策略"。

---

## 二、打包前环境准备

### 2.1 环境要求

| 工具 | 版本 |
|------|------|
| JDK | 17（RN 0.74+）|
| Node.js | 18+ |
| pnpm | 8+ |
| Android SDK | API 34 |
| Build Tools | 34.0.0 |

### 2.2 环境验证

```bash
java -version        # 应显示 17.x.x
node -v              # 应 >= 18
echo $ANDROID_HOME   # 应有路径
```

### 2.3 Debug 版本验证

打包前**必须确保 debug 包能完整跑通**：

```bash
cd NyaMi
pnpm android
```

测试以下场景必须通过：
- [ ] 输入 UID 后能加载到收藏夹
- [ ] 点击视频能开始播放
- [ ] 退到后台音乐继续播放
- [ ] 点击歌曲后等几秒，断开 WiFi 切回应用，应能继续播放（验证缓冲）

---

## 三、纯客户端方案的代码自检清单

> ⚠️ 公网后端方案没有这一步。纯客户端方案打包前**必须做**。

### 3.1 业务层完整性检查

在项目根目录执行：

```bash
# 检查关键文件存在
ls src/core/wbi.ts \
   src/core/http.ts \
   src/services/biliApi.ts \
   src/services/audioService.ts \
   src/services/favoriteService.ts \
   src/services/trackPlayer.ts
```

全部存在才能继续。

### 3.2 WBI 算法版本验证

```bash
# 检查 mixinKeyEncTab 是否完整（应为 64 个数字）
grep -c "," src/core/wbi.ts
# 在 wbi.ts 中应有 mixinKeyEncTab，逗号数应为 63
```

打开 `src/core/wbi.ts` 确认 `mixinKeyEncTab` 数组完整：

```typescript
const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
```

> 💡 建议：定期访问 GitHub 上的 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) 仓库，确认算法是否变更。

### 3.3 敏感数据自检

**禁止在代码中硬编码任何 Cookie/SESSDATA**：

```bash
# 检查代码里是否误把测试 Cookie 提交了
grep -r "SESSDATA=" src/ --include="*.ts" --include="*.tsx"
# 应只有 cookieService.ts 中的占位符，无真实值
```

如果发现真实 SESSDATA，立即清空：

```bash
# 改为占位符
sed -i '' 's/SESSDATA=[a-zA-Z0-9-]*/SESSDATA=YOUR_TOKEN_HERE/g' src/**/*.ts
```

### 3.4 调试开关检查

确认 release 构建时不会输出敏感日志：

```typescript
// src/core/http.ts 中应有
if (__DEV__) {
  http.interceptors.request.use(...);
}
// 而不是无条件添加日志拦截器
```

### 3.5 默认设置自检

打开 `src/store/settingsStore.ts`，确认默认值合理：

```typescript
const init: Settings = storage.getJSON<Settings>(KEY) || {
  quality: 'low',           // ← 默认省流，重要
  autoCacheOnWifi: true,    // ← 默认开启缓存
  wifiOnly: false,
};
```

---

## 四、应用基础信息

### 4.1 包名修改

包名一旦发布**不可更改**，建议第一次打包前确定。

**第一步**：编辑 `android/app/build.gradle`：

```gradle
android {
    namespace "com.yourname.bilimusic"
    defaultConfig {
        applicationId "com.yourname.bilimusic"
    }
}
```

**第二步**：重命名 Java 目录结构：

```
android/app/src/main/java/com/bilimusic/
            ↓ 重命名为
android/app/src/main/java/com/yourname/bilimusic/
```

**第三步**：编辑 `MainActivity.kt` 和 `MainApplication.kt` 顶部包名：

```kotlin
package com.yourname.bilimusic
```

> 💡 建议：使用 Android Studio 打开 android 目录，右键 java 包 → Refactor → Rename 自动完成所有引用更新。

### 4.2 应用名称

`android/app/src/main/res/values/strings.xml`：

```xml
<resources>
    <string name="app_name">B站音乐</string>
</resources>
```

### 4.3 应用图标

推荐使用 [icon.kitchen](https://icon.kitchen/) 在线生成。

设计建议：
- 主色 `#FB7299`（与 APP 内主题一致）
- 形状：圆形或带音符
- 避免使用 B 站官方 logo（侵权风险）

下载得到的 `res` 直接覆盖 `android/app/src/main/res/`。

### 4.4 启动屏

`android/app/src/main/res/values/styles.xml`：

```xml
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:textColor">#000000</item>
        <item name="android:windowBackground">@drawable/launch_screen</item>
    </style>
</resources>
```

`android/app/src/main/res/drawable/launch_screen.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@android:color/white"/>
    <item>
        <bitmap
            android:src="@mipmap/ic_launcher"
            android:gravity="center" />
    </item>
</layer-list>
```

---

## 五、签名密钥（⚠️ 重中之重）

### 5.1 为什么纯客户端方案对密钥更敏感

公网后端方案中，即使密钥丢了，至少接口还能继续提供服务。
**纯客户端方案中，密钥丢失 = 这个 APP 死亡**：
- 你无法发布更新
- 用户的 APK 会随着 B 站接口变更陆续失效
- 每个用户都要换装新签名的 APP（数据全丢）

所以本节请认真对待。

### 5.2 生成 keystore

```bash
keytool -genkeypair -v \
  -keystore bili-music.keystore \
  -alias bili-music \
  -keyalg RSA \
  -keysize 2048 \
  -validity 36500
```

按提示输入：
- 密钥库口令（建议 16 位以上随机串）
- 名字、组织等可填 `BiliMusic`
- 密钥口令（与库口令保持一致）

记录在密码管理器中（推荐 Bitwarden / 1Password）：

```
应用：BiliMusic Keystore
keystore 文件: bili-music.keystore
keystore 密码: ********
key alias: bili-music
key 密码: ********
生成日期: 2024-XX-XX
```

### 5.3 三重备份策略

```
本地副本     →  android/app/bili-music.keystore（不要 git commit！）
密码管理器   →  Bitwarden 附件功能上传 keystore + 密码
私有云盘     →  iCloud / OneDrive 私有目录加密存储
```

加密存储建议：

```bash
# 用 GPG 加密备份
gpg -c bili-music.keystore
# 生成 bili-music.keystore.gpg，可放心放到任何云存储
# 解密：gpg bili-music.keystore.gpg
```

### 5.4 移动到正确位置

```bash
mv bili-music.keystore android/app/
```

### 5.5 配置 .gitignore

确保以下内容在 `.gitignore`：

```
# 签名相关
android/app/*.keystore
android/app/*.jks
android/gradle.properties.local

# 环境/本地配置
.env.local
*.env
```

如果之前误提交过：

```bash
git rm --cached android/app/bili-music.keystore
git commit -m "Remove keystore from git"
# 同时去 GitHub 改密码（如果密码已泄露）
```

### 5.6 配置签名变量

`android/gradle.properties`：

```properties
BILI_MUSIC_UPLOAD_STORE_FILE=bili-music.keystore
BILI_MUSIC_UPLOAD_KEY_ALIAS=bili-music
BILI_MUSIC_UPLOAD_STORE_PASSWORD=你的库密码
BILI_MUSIC_UPLOAD_KEY_PASSWORD=你的key密码
```

或采用环境变量方式（CI 推荐）：

```bash
export BILI_MUSIC_UPLOAD_STORE_FILE=bili-music.keystore
export BILI_MUSIC_UPLOAD_KEY_ALIAS=bili-music
export BILI_MUSIC_UPLOAD_STORE_PASSWORD=xxx
export BILI_MUSIC_UPLOAD_KEY_PASSWORD=xxx
```

---

## 六、Gradle 完整配置

### 6.1 主 build.gradle

`android/build.gradle`：

```gradle
buildscript {
    ext {
        buildToolsVersion = "34.0.0"
        minSdkVersion = 24
        compileSdkVersion = 34
        targetSdkVersion = 34
        ndkVersion = "26.1.10909125"
        kotlinVersion = "1.9.24"
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle")
        classpath("com.facebook.react:react-native-gradle-plugin")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")
    }
}
```

### 6.2 应用 build.gradle

完整 `android/app/build.gradle` 关键部分：

```gradle
apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

react {
    autolinkLibrariesWithApp()
}

def enableProguardInReleaseBuilds = true
def enableHermes = true
def enableSeparateBuildPerCPUArchitecture = true

android {
    ndkVersion rootProject.ext.ndkVersion
    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion
    namespace "com.yourname.bilimusic"

    defaultConfig {
        applicationId "com.yourname.bilimusic"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"

        // 仅保留中文，减少 APK 体积
        resConfigs "zh", "zh-rCN"
    }

    splits {
        abi {
            reset()
            enable enableSeparateBuildPerCPUArchitecture
            universalApk false
            include "arm64-v8a"
            // 如需兼容老设备，加上 "armeabi-v7a"
        }
    }

    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def storeFile_ = System.getenv("BILI_MUSIC_UPLOAD_STORE_FILE") ?:
                (project.hasProperty('BILI_MUSIC_UPLOAD_STORE_FILE') ?
                    BILI_MUSIC_UPLOAD_STORE_FILE : null)

            if (storeFile_ != null) {
                storeFile file(storeFile_)
                storePassword System.getenv("BILI_MUSIC_UPLOAD_STORE_PASSWORD") ?: BILI_MUSIC_UPLOAD_STORE_PASSWORD
                keyAlias    System.getenv("BILI_MUSIC_UPLOAD_KEY_ALIAS")    ?: BILI_MUSIC_UPLOAD_KEY_ALIAS
                keyPassword System.getenv("BILI_MUSIC_UPLOAD_KEY_PASSWORD") ?: BILI_MUSIC_UPLOAD_KEY_PASSWORD
            }
        }
    }

    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            minifyEnabled enableProguardInReleaseBuilds
            shrinkResources enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"

            applicationVariants.all { variant ->
                variant.outputs.each { output ->
                    def versionCodes = ["armeabi-v7a": 1, "x86": 2, "arm64-v8a": 3, "x86_64": 4]
                    def abi = output.getFilter(com.android.build.OutputFile.ABI)
                    if (abi != null) {
                        output.versionCodeOverride =
                            versionCodes.get(abi) * 1048576 + defaultConfig.versionCode
                    }
                }
            }
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
    if (enableHermes) {
        implementation("com.facebook.react:hermes-android")
    } else {
        implementation jscFlavor
    }
}
```

### 6.3 ProGuard 规则（纯客户端版）

`android/app/proguard-rules.pro`：

```proguard
# ========== React Native 默认 ==========
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip

-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keep @com.facebook.common.internal.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}

-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# ========== 第三方依赖 ==========

# react-native-track-player
-keep class com.doublesymmetry.trackplayer.** { *; }
-keep class com.google.android.exoplayer2.** { *; }
-dontwarn com.google.android.exoplayer2.**

# react-native-fs
-keep class com.rnfs.** { *; }

# MMKV
-keep class com.tencent.mmkv.** { *; }

# react-native-fast-image
-keep public class com.dylanvann.fastimage.* { *; }
-keep public class com.dylanvann.fastimage.** { *; }
-keep public class * implements com.bumptech.glide.module.GlideModule
-keep public class * extends com.bumptech.glide.module.AppGlideModule
-keep public enum com.bumptech.glide.load.ImageHeaderParser$** { **[] $VALUES; public *; }

# react-native-vector-icons
-keep class com.oblador.vectoricons.** { *; }

# NetInfo
-keep class com.reactnativecommunity.netinfo.** { *; }

# OkHttp / Axios 底层
-dontwarn okhttp3.**
-dontwarn okio.**

# 反射通用
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes EnclosingMethod
-keepattributes InnerClasses
```

### 6.4 性能优化（gradle.properties）

`android/gradle.properties`：

```properties
# JVM 内存（提升构建速度）
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m

# 并行构建
org.gradle.parallel=true
org.gradle.configureondemand=true

# 启用构建缓存
org.gradle.caching=true

# 启用 Hermes
hermesEnabled=true

# 新架构（可选，建议保持默认 false）
newArchEnabled=false
```

---

## 七、网络与权限配置（纯客户端简化版）

### 7.1 仅需的最小权限

`android/app/src/main/AndroidManifest.xml`：

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- 网络访问（必需） -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!-- 后台播放（TrackPlayer 需要） -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />

    <!-- Android 13+ 通知权限（音乐通知需要） -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:name=".MainApplication"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:allowBackup="false"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="false"   ← 纯客户端关键：直连 B 站，全 HTTPS
        android:networkSecurityConfig="@xml/network_security_config">

        <activity
            android:name=".MainActivity"
            android:label="@string/app_name"
            android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

### 7.2 网络安全配置（更严格）

> 与公网后端方案相比，纯客户端**不需要任何 cleartextTraffic 例外**。

`android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- 严格 HTTPS only -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- 仅允许 B 站域名 -->
    <domain-config>
        <domain includeSubdomains="true">bilibili.com</domain>
        <domain includeSubdomains="true">bilivideo.com</domain>
        <domain includeSubdomains="true">hdslb.com</domain>
    </domain-config>
</network-security-config>
```

这种配置的好处：
- 即使应用被劫持也无法走 HTTP 中间人
- 安装文件被篡改后无法自由请求其他域名
- 是隐私和安全的良好声明

### 7.3 隐私清单（Android 14+）

`android/app/src/main/res/xml/data_extraction_rules.xml`（可选）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <!-- 不允许云备份用户数据 -->
    <cloud-backup>
        <exclude domain="root"/>
    </cloud-backup>
    <device-transfer>
        <exclude domain="root"/>
    </device-transfer>
</data-extraction-rules>
```

`AndroidManifest.xml` 的 application 标签加：

```xml
android:dataExtractionRules="@xml/data_extraction_rules"
```

---

## 八、构建 APK

### 8.1 完整构建流程

```bash
# 1. 清理项目（强烈建议每次构建前执行）
cd android
./gradlew clean
cd ..

# 2. 清理 RN 缓存（遇到诡异问题时）
watchman watch-del-all 2>/dev/null
rm -rf node_modules/.cache
rm -rf /tmp/metro-*
rm -rf /tmp/haste-*

# 3. 构建 release APK
cd android
./gradlew assembleRelease
```

构建时间预估：
- 首次构建：5-10 分钟
- 后续构建：2-4 分钟

### 8.2 产物位置

```
android/app/build/outputs/apk/release/
└── app-arm64-v8a-release.apk      # ← 这就是要分发的文件
```

### 8.3 验证签名

```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify -v \
  android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

应输出：
```
Verified using v1 scheme (JAR signing): true
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v4 scheme (APK Signature Scheme v4): false   ← 可选，不影响
Number of signers: 1
```

### 8.4 查看 APK 详情

```bash
$ANDROID_HOME/build-tools/34.0.0/aapt2 dump badging \
  android/app/build/outputs/apk/release/app-arm64-v8a-release.apk \
  | head -10
```

应能看到包名、版本号、应用名等信息。

### 8.5 体积参考

纯客户端方案的预期体积：

| 配置 | APK 体积 |
|------|---------|
| Universal（全 ABI）+ Hermes | ~70 MB |
| arm64-v8a only + Hermes + ProGuard | **~28 MB** ← 推荐 |
| 同时打 v7a 和 v8a | ~50 MB |

---

## 九、版本升级策略（纯客户端核心难点）

> ⚠️ 这一节是公网后端方案完全不需要考虑的，但纯客户端方案必须处理。

### 9.1 何时必须发新版本

| 触发条件 | 紧急程度 | 说明 |
|---------|---------|------|
| WBI 算法变更 | 🔴 紧急 | B 站偶尔会改，所有版本立即失效 |
| 接口路径变更 | 🔴 紧急 | 比如 `/x/v3/fav/...` 改路径 |
| 接口字段变更 | 🟡 中 | 解析报错，但能做容错 |
| 新增风控（如设备指纹）| 🔴 紧急 | 需要更新签名逻辑 |
| 客户端 bug 修复 | 🟢 一般 | 按需 |
| 功能更新 | 🟢 一般 | 按需 |

历史上 WBI 算法变更频率：
- 2023 年初引入：1 次
- 2023-2024 年间：约 2-3 次小调整

### 9.2 应用内版本检查机制（强烈推荐）

实现思路：在 GitHub 发布版本元数据，APP 启动时检查。

#### 第一步：创建版本配置文件

在 GitHub 仓库创建 `version.json`（启用 GitHub Pages 或者使用 jsDelivr CDN）：

```json
{
  "latestVersion": "1.0.1",
  "latestVersionCode": 2,
  "minSupportedVersion": "1.0.0",
  "minSupportedVersionCode": 1,
  "downloadUrl": "https://github.com/yourname/bili-music/releases/latest",
  "releaseNotes": "修复 WBI 算法变更导致的播放失败问题",
  "isForceUpdate": false,
  "wbiAlgorithmVersion": 2
}
```

字段说明：
- `latestVersion`：最新版本号
- `minSupportedVersion`：最低支持版本（低于此版本无法使用）
- `isForceUpdate`：是否强制升级（true 时禁止使用旧版）
- `wbiAlgorithmVersion`：WBI 算法版本（变更时强制升级）

#### 第二步：客户端检查代码

```typescript
// src/services/versionCheck.ts
import axios from 'axios';
import { Alert, Linking, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
// pnpm add react-native-device-info

const VERSION_URL = 'https://yourname.github.io/bili-music/version.json';

interface VersionInfo {
  latestVersion: string;
  latestVersionCode: number;
  minSupportedVersion: string;
  minSupportedVersionCode: number;
  downloadUrl: string;
  releaseNotes: string;
  isForceUpdate: boolean;
  wbiAlgorithmVersion: number;
}

export async function checkVersion() {
  try {
    const { data } = await axios.get<VersionInfo>(VERSION_URL, {
      timeout: 5000,
      // 加随机参数，避免 GitHub Pages 缓存
      params: { _t: Date.now() },
    });

    const currentCode = await DeviceInfo.getBuildNumber();
    const currentNum = parseInt(currentCode, 10);

    // 1. 强制升级
    if (currentNum < data.minSupportedVersionCode) {
      Alert.alert(
        '版本过旧',
        `当前版本不再支持，请升级到 v${data.latestVersion}\n\n${data.releaseNotes}`,
        [
          { text: '前往下载', onPress: () => Linking.openURL(data.downloadUrl) },
        ],
        { cancelable: false }
      );
      return;
    }

    // 2. 提示升级
    if (currentNum < data.latestVersionCode) {
      Alert.alert(
        '发现新版本',
        `v${data.latestVersion}\n\n${data.releaseNotes}`,
        [
          { text: '稍后' },
          { text: '前往下载', onPress: () => Linking.openURL(data.downloadUrl) },
        ]
      );
    }
  } catch {
    // 静默失败，不打扰用户
  }
}
```

App.tsx 中调用：

```typescript
useEffect(() => {
  // 启动 3 秒后检查（避免影响首屏）
  setTimeout(checkVersion, 3000);
}, []);
```

#### 第三步：发版时更新 version.json

每次发版后，更新 GitHub 仓库的 `version.json` 文件，commit & push 即可。

### 9.3 版本号管理规范

每次发布修改 `android/app/build.gradle`：

```gradle
defaultConfig {
    versionCode 2          // 整数，每次 +1，不可回退
    versionName "1.0.1"    // 用户可见，遵循语义化版本
}
```

语义化版本规则：
- `1.0.1` 修复（bug 修复、WBI 同步）
- `1.1.0` 功能（新增功能）
- `2.0.0` 重大（不兼容更新）

---

## 十、APK 体积进一步优化

### 10.1 优化效果汇总

| 优化项 | 节省体积 | 已默认开启？ |
|-------|---------|--------|
| ABI 切分（仅 arm64） | -60% | ✅ |
| Hermes 引擎 | -3 MB | ✅ |
| ProGuard / R8 | -15% | ✅ |
| 资源压缩 | -5% | ✅ |
| 仅中文 locale | -1 MB | ✅ |
| WebP 替代 PNG | -30% 图片体积 | ❌ 需手动 |
| 字体子集化 | -2 MB | ❌ 需手动 |

### 10.2 WebP 转换（可选）

```bash
# 批量转换 mipmap 中的 PNG
for file in android/app/src/main/res/mipmap-*/*.png; do
  cwebp -q 85 "$file" -o "${file%.png}.webp"
  rm "$file"
done
```

修改引用（一般 Android 系统会自动识别 webp 格式）。

### 10.3 字体子集化

`react-native-vector-icons` 默认包含完整字体（约 1-2 MB）。如果只用一小部分图标，可以子集化：

```bash
pnpm add -D fontmin
```

只保留使用到的字符（高级优化，按需）。

### 10.4 体积分析

```bash
# 用 Android Studio 的 Analyze APK
# 或命令行
$ANDROID_HOME/build-tools/34.0.0/aapt2 dump apk-info \
  android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

典型体积构成：
```
Hermes 引擎      ~5 MB
React Native    ~6 MB
ExoPlayer       ~3 MB
TrackPlayer     ~1 MB
图标字体         ~2 MB
应用图标         ~500 KB
JS Bundle       ~500 KB
其他            ~10 MB
─────────────
总计           ~28 MB
```

---

## 十一、安装与功能测试

### 11.1 安装命令

```bash
# 通过 ADB 安装
adb devices                                              # 确认设备已连接
adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

### 11.2 完整功能测试清单（纯客户端版）

> 与公网后端方案相比，多了几项专门针对纯客户端的检查。

#### 基础功能

- [ ] 启动后能看到首页
- [ ] 输入 UID 能加载收藏夹列表
- [ ] 点击收藏夹能加载视频列表
- [ ] 视频列表能滚动到底加载更多
- [ ] 点击视频能开始播放
- [ ] 切到桌面后音乐继续
- [ ] 锁屏后通知栏显示音乐控件
- [ ] 通知栏播放/暂停/切歌正常

#### 纯客户端特有

- [ ] **WBI 签名生效**：能播放视频（不返回 -352 错误）
- [ ] **直连验证**：抓包确认请求只发送到 `*.bilibili.com`
- [ ] **离线缓存命中**：听完一首歌，关 WiFi 重新播放，能继续
- [ ] **设置 Cookie 后**：能加载私密收藏夹
- [ ] **清空缓存**：缓存大小变成 0，磁盘空间释放
- [ ] **版本检查**：启动 3 秒后能从 GitHub 拉到 version.json

#### 流量优化

- [ ] 设置中切换到"省流"模式
- [ ] 同一首歌第二次播放，**不发起任何网络请求**（用 charles/抓包工具确认）
- [ ] 切回收藏夹列表，5 分钟内不重新请求

#### 边界情况

- [ ] 输入不存在的 UID，提示合理错误
- [ ] 网络断开时点歌，提示网络错误
- [ ] B 站返回 -352 时，能给出"WBI 签名失败，请升级"提示
- [ ] 私密收藏夹未登录时，提示"需要 Cookie"

### 11.3 离线场景测试（重点）

```
场景 1：缓存命中
1. WiFi 状态下播放歌曲 A 完整一遍
2. 关闭 WiFi 和移动数据
3. 重新点击歌曲 A
4. 期望：能正常播放
```

```
场景 2：弱网恢复
1. WiFi 状态下播放歌曲，进度 30%
2. 关闭 WiFi
3. 期望：当前缓冲段播完后停止
4. 重开 WiFi
5. 期望：自动恢复播放
```

### 11.4 release 包调试

```bash
# 实时查看应用日志
adb logcat *:E | grep -i "bilimusic\|AndroidRuntime\|ReactNative\|TrackPlayer"

# 仅查看崩溃栈
adb logcat -d *:E > crash.log
grep -A 30 "AndroidRuntime" crash.log
```

---

## 十二、自动化构建脚本

### 12.1 一键打包脚本

`scripts/build-apk.sh`：

```bash
#!/bin/bash
set -e

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}[1/5] 代码自检...${NC}"

# 检查关键文件
REQUIRED_FILES=(
    "src/core/wbi.ts"
    "src/core/http.ts"
    "src/services/biliApi.ts"
    "src/services/audioService.ts"
)
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        echo -e "${RED}❌ 缺失关键文件: $f${NC}"
        exit 1
    fi
done

# 检查敏感信息
if grep -rE "SESSDATA=[a-zA-Z0-9-]{20,}" src/ --include="*.ts" --include="*.tsx" 2>/dev/null; then
    echo -e "${RED}❌ 检测到代码中疑似硬编码 SESSDATA，请清除${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 代码自检通过${NC}"

echo -e "${YELLOW}[2/5] 清理旧产物...${NC}"
cd android
./gradlew clean
cd ..

echo -e "${YELLOW}[3/5] 开始打包 release APK...${NC}"
cd android
./gradlew assembleRelease
cd ..

# 重命名
VERSION_NAME=$(grep versionName android/app/build.gradle | head -1 | awk -F'"' '{print $2}')
DATE=$(date +%Y%m%d)
SOURCE="android/app/build/outputs/apk/release/app-arm64-v8a-release.apk"
mkdir -p dist
TARGET="dist/bili-music-v${VERSION_NAME}-${DATE}.apk"
cp "$SOURCE" "$TARGET"

echo -e "${YELLOW}[4/5] 验证签名...${NC}"
if [ -d "$ANDROID_HOME/build-tools/34.0.0" ]; then
    "$ANDROID_HOME/build-tools/34.0.0/apksigner" verify "$TARGET" && \
        echo -e "${GREEN}✓ 签名验证通过${NC}" || \
        echo -e "${RED}✗ 签名验证失败${NC}"
fi

SIZE=$(du -h "$TARGET" | cut -f1)

echo -e "${YELLOW}[5/5] 完成！${NC}"
echo -e "${GREEN}✅ 文件: $TARGET${NC}"
echo -e "${GREEN}✅ 大小: $SIZE${NC}"
echo -e "${GREEN}✅ 版本: v${VERSION_NAME}${NC}"

echo
echo -e "${YELLOW}下一步：${NC}"
echo -e "  1. 在真机测试: adb install -r $TARGET"
echo -e "  2. 通过 11.2 节的功能测试清单"
echo -e "  3. 上传到 GitHub Release"
echo -e "  4. 更新 GitHub Pages 上的 version.json"
```

### 12.2 在 package.json 集成

```json
{
  "scripts": {
    "android": "react-native run-android",
    "build:apk": "bash scripts/build-apk.sh",
    "build:clean": "cd android && ./gradlew clean && cd ..",
    "verify:apk": "$ANDROID_HOME/build-tools/34.0.0/apksigner verify -v dist/*.apk"
  }
}
```

使用：

```bash
chmod +x scripts/build-apk.sh
pnpm build:apk
```

### 12.3 GitHub Actions 自动化

`.github/workflows/build.yml`：

```yaml
name: Build APK

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install dependencies
        run: |
          npm install -g pnpm
          pnpm install --frozen-lockfile

      - name: Decode keystore
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
        run: |
          echo "$KEYSTORE_BASE64" | base64 -d > android/app/bili-music.keystore

      - name: Build APK
        env:
          BILI_MUSIC_UPLOAD_STORE_FILE: bili-music.keystore
          BILI_MUSIC_UPLOAD_KEY_ALIAS: bili-music
          BILI_MUSIC_UPLOAD_STORE_PASSWORD: ${{ secrets.STORE_PASSWORD }}
          BILI_MUSIC_UPLOAD_KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
        run: |
          cd android
          ./gradlew assembleRelease

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-release
          path: android/app/build/outputs/apk/release/*.apk

      - name: Create Release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: android/app/build/outputs/apk/release/*.apk
          generate_release_notes: true
```

GitHub Secrets 配置：

```bash
# 1. 把 keystore 转 base64
base64 -i android/app/bili-music.keystore | pbcopy

# 2. 在 GitHub: Settings → Secrets → Actions 添加
#    KEYSTORE_BASE64
#    STORE_PASSWORD
#    KEY_PASSWORD
```

打 tag 触发自动构建：

```bash
git tag v1.0.0
git push origin v1.0.0
# GitHub Actions 自动构建并发 Release
```

---

## 十三、分发渠道

### 13.1 推荐分发方式（按优先级）

| 渠道 | 适合场景 | 优缺点 |
|------|---------|------|
| **GitHub Release** | 个人/朋友圈 | ⭐ 推荐：免费、稳定、有版本管理 |
| **F-Droid** | 开源项目 | 需要审核，但是好的开源应用归宿 |
| **酷安** | 国内用户 | 中文圈友好，但有内容审核 |
| 蓝奏云/123 网盘 | 临时分享 | 简单，但链接易失效 |
| **不要**：Google Play | - | ❌ 涉及第三方接口，会被下架 |
| **不要**：国内安卓应用商店 | - | ❌ 同上，且需要软著 |

### 13.2 GitHub Release 最佳实践

每次发版：

```bash
# 1. 更新 version.json
vim version.json
git add version.json
git commit -m "Release v1.0.1"

# 2. 打 tag
git tag v1.0.1
git push origin main --tags

# 3. GitHub Actions 自动出包并创建 Release

# 4. 编辑 Release 描述
# 在网页上补充：
#   - 更新内容
#   - 已知问题
#   - 安装方法
#   - 校验和（SHA256）
```

Release 描述模板：

```markdown
## 🎵 Bili Music v1.0.1

### 更新内容
- 修复 WBI 算法变更导致的播放失败
- 优化省流模式下的缓存命中率

### 安装
1. 下载 `bili-music-v1.0.1-arm64.apk`
2. 在手机上点击安装（需开启"允许安装未知来源"）
3. 已安装旧版本可直接覆盖更新

### 校验
SHA256: `xxxxxxxxxx`

### 系统要求
Android 7.0+ (API 24+)
```

### 13.3 隐私分发（仅自用）

如果只是自己用，直接：

```bash
# AirDrop 给自己手机
open -R dist/bili-music-v1.0.0.apk

# 或 ADB 一键装
adb install -r dist/bili-music-v1.0.0.apk
```

---

## 十四、隐私与合规

### 14.1 应用内隐私说明（推荐添加）

在设置页"关于"分组添加"隐私说明"链接：

```typescript
// 在设置页加上
<ListItem
  title="隐私说明"
  onPress={() => navigation.navigate('Privacy')}
  showArrow
/>
```

`PrivacyScreen.tsx`：

```typescript
import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { Header } from '../components/Header';
import { useTheme } from '../theme';

export const PrivacyScreen = () => {
  const t = useTheme();
  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: t.spacing.lg },
    h1: { fontSize: t.fontSize.lg, fontWeight: '600', color: t.colors.text, marginTop: t.spacing.lg },
    p: { fontSize: t.fontSize.base, color: t.colors.textSub, lineHeight: 22, marginTop: t.spacing.sm },
  });

  return (
    <>
      <Header title="隐私说明" showBack />
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.h1}>数据收集</Text>
        <Text style={s.p}>
          本应用不收集任何用户个人信息。所有数据（UID、Cookie、播放历史、缓存）仅保存在本地手机上。
        </Text>

        <Text style={s.h1}>网络请求</Text>
        <Text style={s.p}>
          本应用直接连接 bilibili.com 提供的公开 API，不经过任何第三方服务器。
          所有网络请求强制使用 HTTPS 加密。
        </Text>

        <Text style={s.h1}>缓存数据</Text>
        <Text style={s.p}>
          为节省流量，本应用会将已播放过的音频缓存到设备本地存储中。
          可在设置中查看和清空。卸载应用时所有数据自动删除。
        </Text>

        <Text style={s.h1}>第三方服务</Text>
        <Text style={s.p}>
          应用会从 GitHub 拉取版本检查信息（version.json），
          仅返回版本号信息，不传输任何用户数据。
        </Text>

        <Text style={s.h1}>免责声明</Text>
        <Text style={s.p}>
          本应用是个人开发者制作的非官方工具，与哔哩哔哩公司无关。
          请勿用于商业用途或公开传播下载的音频文件。
          使用本应用产生的任何法律风险由用户自行承担。
        </Text>
      </ScrollView>
    </>
  );
};
```

### 14.2 GitHub README 必备内容

```markdown
## 项目说明

⚠️ 这是一个个人学习项目，仅供个人使用。

## 免责声明

- 本项目与哔哩哔哩官方无关
- 不得用于商业用途
- 不得传播下载的音频内容
- 使用风险自负

## 隐私
- 不收集任何用户数据
- 直连 B 站 API，无中间服务器
- 所有数据仅保存在本地

## 已知风险
- B 站可能更新接口导致旧版本失效
- 使用频率过高可能触发 B 站风控（建议合理使用）
```

---

## 十五、常见问题排查

### 15.1 构建相关

| 报错 | 原因 | 解决 |
|------|------|------|
| `SDK location not found` | ANDROID_HOME 未设 | 创建 `android/local.properties`，写入 `sdk.dir=/path/to/sdk` |
| `Could not find tools.jar` | JDK 版本问题 | 切换到 JDK 17 |
| `Duplicate class` | 依赖冲突 | `./gradlew clean` 后重试 |
| `Out of memory` | 内存不足 | 改 `org.gradle.jvmargs=-Xmx4g` |
| `Execution failed for task ':app:bundleReleaseJsAndAssets'` | JS 打包失败 | 单独运行 `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/test.bundle` 看具体错误 |
| `Cannot find module 'react-native-track-player'` | 依赖未安装 | `pnpm install` |

### 15.2 运行相关

| 现象 | 原因 | 解决 |
|------|------|------|
| 安装后图标灰色不可点 | ProGuard 把启动 Activity 混淆了 | 在 proguard-rules.pro 加 `-keep class .yourpackage.MainActivity { *; }` |
| 启动闪退 | 多种可能 | `adb logcat -d *:E` 看崩溃栈 |
| 播放报 -352 | WBI 签名失败 | 检查 `wbi.ts` 中 `mixinKeyEncTab` 完整性 |
| 接口报 -101 | 私密收藏夹/未登录 | 引导用户填 Cookie |
| 后台播放 5 分钟被杀 | 厂商电池优化 | 引导用户在设置中给应用"无限制后台" |
| 通知栏不显示控件 | Android 13+ 通知权限 | 确认 manifest 加了 `POST_NOTIFICATIONS` |

### 15.3 纯客户端方案特有问题

#### 问题 1：所有视频都报 -352

可能原因：
1. WBI 算法已变更
2. mixinKeyEncTab 数组不完整
3. 时间戳格式错误

排查：

```typescript
// 临时在 wbi.ts 加日志
console.log('WBI sign:', { wts, mixinKey, query });
```

如果是算法变更，需要：
1. 查看 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) 最新算法
2. 更新代码
3. 发新版本

#### 问题 2：能播放但音质很差

可能原因：未登录，B 站只给低音质流。

解决：在设置中输入 Cookie。

#### 问题 3：版本检查失败

可能原因：GitHub 在国内访问不稳定。

改进：

```typescript
// 多源 fallback
const VERSION_URLS = [
  'https://yourname.github.io/bili-music/version.json',
  'https://gitee.com/yourname/bili-music/raw/main/version.json', // 国内镜像
  'https://cdn.jsdelivr.net/gh/yourname/bili-music@main/version.json',
];
```

---

## 十六、最终发布检查清单

发布 APK 给真实用户前的最后核对：

### 代码层面
- [ ] 没有硬编码任何 Cookie / SESSDATA
- [ ] 没有遗留的 `console.log` 输出敏感信息
- [ ] WBI mixinKeyEncTab 数组完整（64 项）
- [ ] 默认音质设为 `low`
- [ ] 删除所有 TODO 标记的未完成功能

### 配置层面
- [ ] `applicationId` 是最终包名
- [ ] `versionCode` 与 `versionName` 已正确设置
- [ ] 应用图标与启动屏已替换
- [ ] 应用名称是中文正式名
- [ ] AndroidManifest 中 `usesCleartextTraffic="false"`
- [ ] networkSecurityConfig 仅允许 B 站域名

### 安全层面
- [ ] keystore 已**离线备份至少 3 处**
- [ ] keystore 密码已**离线备份**
- [ ] `.gitignore` 包含 keystore
- [ ] release 包测试过 ProGuard 不导致崩溃

### 构建层面
- [ ] `assembleRelease` 成功，无 error
- [ ] APK 用 `apksigner verify` 校验通过
- [ ] APK 体积合理（约 25-35 MB）
- [ ] 在真机上完整测试 11.2 节清单

### 版本管理
- [ ] GitHub Pages 已配置 version.json
- [ ] checkVersion 调用已在 App.tsx
- [ ] Release Notes 已撰写

### 隐私合规
- [ ] 应用内有隐私说明页
- [ ] GitHub README 有免责声明
- [ ] APK 命名清晰（不包含敏感词）

### 分发准备
- [ ] APK 已上传 GitHub Release
- [ ] SHA256 校验和已发布
- [ ] 安装说明文档已准备

---

## 十七、版本升级流程速查

每次发布新版本的标准动作：

```bash
# 1. 修改版本号
vim android/app/build.gradle
#   versionCode 2
#   versionName "1.0.1"

# 2. 修改 version.json
vim version.json

# 3. 提交
git add .
git commit -m "Release v1.0.1: 修复 WBI 签名"

# 4. 打 tag
git tag v1.0.1
git push origin main --tags

# 5. GitHub Actions 自动构建（如果配置了）
# 或手动构建
pnpm build:apk

# 6. 在 GitHub Release 页编辑发布说明
# https://github.com/yourname/bili-music/releases

# 7. 通知用户
# - 用户启动 APP 会自动弹窗提示
# - 也可以发朋友圈/群通知
```

---

## 十八、流程对比总结

为了让你彻底理解纯客户端方案的特殊性，对比一下两种方案的发版流程：

```
═════════════════════════════════════════
公网后端方案：B 站接口变更时
═════════════════════════════════════════
  1. 修改后端代码
  2. 重新部署后端
  3. 用户无感知，立即生效
  ──────────────────────
  影响范围：1 台服务器
  应对时间：几分钟
═════════════════════════════════════════


═════════════════════════════════════════
纯客户端方案：B 站接口变更时
═════════════════════════════════════════
  1. 修改客户端代码
  2. 升 versionCode + versionName
  3. 重新构建 APK
  4. 上传 GitHub Release
  5. 更新 version.json
  6. 等用户主动更新
  ──────────────────────
  影响范围：所有用户
  应对时间：几小时-几天
═════════════════════════════════════════
```

这就是为什么我之前说"集中升级 WBI 算法"是公网后端方案的优势之一。

但好处是：
- 你不需要维护服务器
- 用户隐私更好
- 没有持续成本

权衡之下，对个人项目而言，**纯客户端依然是更优解**。

---

## 总结

至此，纯客户端方案下从代码自检到 APK 分发的完整流程文档结束。

**核心要点**：

1. **代码自检**：每次打包前必须确认 WBI 算法、业务层代码完整
2. **签名安全**：keystore 必须三重备份
3. **网络配置**：严格 HTTPS only，仅允许 B 站域名
4. **版本检查**：实现应用内版本检查，应对 WBI 变更
5. **分发渠道**：GitHub Release > F-Droid > 私有分发
6. **隐私合规**：应用内说明 + GitHub README 免责声明

**推荐工作流**：

```
开发 → 测试 → 自检 → 构建 → 验证 → 上传 GitHub → 更新 version.json
```

---