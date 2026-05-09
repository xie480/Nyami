<div align="center">
  <img src="resource/icon.png" width="120" height="120" alt="Nyami Icon"/>

# Nyami

### 🐾 A Modern Bilibili Audio Player for Android

基于 React Native 构建的 **Bilibili 第三方纯音频播放器**  
专注于 **高音质 · 离线同步 · 专业 DSP 调音体验**

<p>
<img src="https://img.shields.io/badge/Platform-Android-green?style=for-the-badge"/>
<img src="https://img.shields.io/badge/React%20Native-0.74-blue?style=for-the-badge"/>
<img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Media3-ExoPlayer-orange?style=for-the-badge"/>
<img src="https://img.shields.io/badge/License-MIT-purple?style=for-the-badge"/>
</p>

</div>

---

# ✨ 项目简介

**Nyami** 是一款面向 Bilibili 用户打造的高质量纯音频播放器。

它能够解析 B 站视频音频流，并通过本地同步数据库与原生音频 DSP 引擎，为用户提供：

- 高品质在线播放
- 收藏夹离线同步
- 专业级 EQ 调音
- 沉浸式现代播放器 UI
- 弱网 / 离线环境无缝切换

Nyami 的目标不是简单“听视频”，而是打造 **真正可替代主流音乐 App 的 Bilibili 音乐生态体验**。

---

# 🚀 核心特性

## 🎧 专业级音频引擎

基于 **Media3 / ExoPlayer** 深度定制音频处理链：

- 10 段 Graphic EQ
- 8 段 Parametric EQ（PEQ）
- Biquad / RBJ 滤波器
- 实时 FFT 分析
- OpenGL 频谱渲染
- 猫耳动态频谱动画
- 后台播放 / 锁屏控制 / 通知栏媒体中心集成

---

## 📦 离线收藏夹同步

基于 **WatermelonDB** 构建高性能本地增量同步架构：

- 收藏夹全量同步
- 增量更新检测
- 本地索引持久化
- 弱网自动降级
- 离线缓存播放
- 断点恢复同步

即使离线，也能像本地音乐播放器一样使用。

---

## 🔐 深度 Bilibili API 集成

内置：

- WBI 签名算法
- Cookie 状态管理
- 收藏夹权限解析
- 高音质音频流获取
- API 限流令牌桶保护

保障账号安全与稳定访问。

---

## 🎨 现代化 UI 体验

Nyami 提供完整沉浸式设计语言：

- Glassmorphism 毛玻璃主题
- 深色模式
- 流畅手势交互
- 全局动态模糊
- Android 原生媒体面板联动
- 锁屏播放器控制

---

# 🛠 技术栈

## Frontend

- **React Native 0.74**
- **TypeScript**
- **React Navigation 7**
- **Zustand**
- **WatermelonDB**
- **MMKV**
- **React Native Track Player**

---

## Android Native

- **Kotlin**
- **Media3 / ExoPlayer**
- **OpenGL ES**
- **JNI / C++ DSP**
- **Custom AudioProcessor Pipeline**

---

# 📂 项目架构

```text
Nyami
├── src/
│   ├── screens/
│   ├── components/
│   ├── store/
│   ├── database/
│   ├── api/
│   └── player/
│
├── android/
│   ├── native-dsp/
│   ├── audio-engine/
│   └── spectrum-renderer/
│
└── resource/
```

---

# ⚡ 快速开始

## 环境要求

- Node.js ≥ 18
- JDK 17
- Android Studio
- Android SDK 34+
- Yarn / npm

---

## 安装

```bash
git clone <repository-url>
cd Nyami
npm install
```

或

```bash
yarn install
```

---

## 启动 Metro

```bash
npm start
```

---

## 启动 Android

```bash
npm run android
```

---

# 🔑 登录 Bilibili

为了访问：

- 私密收藏夹
- 更高音质流
- 用户订阅内容

请在应用内：

`设置 → 账号登录`

Nyami 会自动完成：

- WBI 鉴权
- Cookie 刷新
- 请求签名

---

# ⚠️ 注意事项

- 首次使用请前往设置页面同步全局索引
- 当前仅支持 **Android**
- 推荐 Android 12+
- 测试设备：

```text
iQOO 11S · Android 15
```

- 内置限流保护机制，避免高频请求触发风控

---

# 📜 License

MIT License

---

<div align="center">

**Nyami · 吾辈只是一只猫罢了 🐾**

</div>