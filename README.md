<div align="center">
  <img src="resource/icon.png" width="120" height="120" alt="Nyami Icon" />
  <h1>Nyami</h1>
  <p>基于 React Native 的 B 站第三方纯音频播放器，专注于高音质与离线体验</p>
</div>

## 📖 项目定位

Nyami 是一款专为 Bilibili 用户打造的第三方纯音频播放应用。它通过解析 B 站视频音频流，结合本地数据库同步机制与自定义底层音频 DSP 引擎，为用户提供无缝的在线/离线音乐聆听体验。

## ✨ 核心特点

- **原生级音频 DSP 引擎**：深度定制 ExoPlayer/Media3 音频处理链路，内置 10 段图形均衡器 (Graphic EQ) 与 8 段参数均衡器 (PEQ)，支持实时 FFT 频谱分析与可视化。
- **强大的离线同步机制**：基于 WatermelonDB 构建本地增量同步架构，支持 B 站收藏夹全量/增量同步，断网环境下依然可以流畅播放本地缓存音频。
- **B 站原生 API 深度集成**：内置 B 站 WBI 签名算法与 Cookie 状态管理，支持获取高音质音频流与私密收藏夹内容。
- **现代化的 UI 设计**：全面支持毛玻璃 (Glassmorphism) 主题与深色模式，提供流畅的手势交互与沉浸式播放体验。

## 🚀 主要功能

- **收藏夹同步**：一键同步 B 站账号下的视频收藏夹，支持后台增量更新与同步状态追踪。
- **纯音频播放**：提取 B 站视频的高音质音频流进行播放，支持后台播放、锁屏控制与播放列表管理。
- **Sound Lab (音效实验室)**：提供专业的 EQ 调节界面，支持自定义 PEQ 滤波器参数与预设管理，实时渲染音频频谱。
- **智能缓存与网络管理**：自适应网络状态，离线时自动切换至本地缓存播放，节省流量。

## 🛠️ 技术栈

### 前端 (React Native)
- **框架**: React Native 0.74.5 + TypeScript
- **状态管理**: Zustand 5.0
- **本地存储**: WatermelonDB (关系型数据) + react-native-mmkv (键值配置)
- **导航**: React Navigation 7
- **音频播放**: react-native-track-player 4.1.2

### 原生端 (Android)
- **音频引擎**: ExoPlayer / Media3
- **DSP 处理**: 自定义 `DSPAudioProcessor` (Kotlin/C++)，实现 Biquad / RBJ 滤波器
- **频谱渲染**: OpenGL ES (`SpectrumGLSurfaceView`)

## 📦 部署与运行

### 环境要求
- Node.js >= 18
- JDK 17
- Android Studio & Android SDK (API 34+)
- Yarn 或 npm

### 1. 克隆项目与安装依赖

```bash
git clone <repository-url>
cd BiliMusic
npm install
# 或使用 yarn
yarn install
```

### 2. 启动 Metro Bundler

```bash
npm run start
```

### 3. 运行应用 (Android)

保持 Metro Bundler 运行，在新的终端窗口中执行：

```bash
npm run android
```

### 4. 配置 B 站 Cookie (可选)

为了访问私密收藏夹和获取最高音质的音频流，建议在应用内的“设置”页面登录 B 站账号或手动配置 Cookie。应用内置了 WBI 签名算法，可自动处理 API 请求鉴权。

---
*注：本项目仅供学习交流使用，请勿用于商业用途。*
