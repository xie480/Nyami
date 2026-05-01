# BiliMusic AI 编码规范与约束指南
> 本文档为 AI 助手在参与 BiliMusic 项目开发时必须严格遵守的编码规范与约束条件。
> 项目定位：**无公网后端的纯客户端 B 站音乐播放器**。
## 一、 项目总文件架构分布
本项目采用严格的分层架构，将原本属于后端的逻辑（API 请求、WBI 签名、缓存、限流）整体迁移至客户端的 `src/core/` 和 `src/services/` 目录中。
```text
src/
├── config/             # 配置常量 (biliBaseURL, userAgent, cacheTTL, rateLimit)
├── types/              # 类型定义 (bili.ts 原始接口类型, domain.ts 业务模型)
├── core/               # 核心层：底层通用能力 (禁止包含业务逻辑)
│   ├── storage.ts      # MMKV 持久化封装
│   ├── http.ts         # Axios 实例 + 拦截器
│   ├── wbi.ts          # WBI 签名算法
│   ├── cache.ts        # 多级缓存 (TTL + LRU)
│   ├── rateLimit.ts    # 客户端限流 (令牌桶)
│   └── errors.ts       # 统一错误类型
├── services/           # 服务层：业务逻辑编排 (调用 core/ 能力)
│   ├── biliApi.ts      # B 站 API 原始调用
│   ├── transformers.ts # 字段精简映射
│   ├── favoriteService.ts # 收藏夹业务
│   ├── audioService.ts # 音频信息业务
│   ├── cookieService.ts# 用户 Cookie 管理
│   ├── audioCache.ts   # 本地音频缓存服务
│   ├── netStatus.ts    # 网络状态监测
│   └── trackPlayer.ts  # 播放器服务 (react-native-track-player)
├── theme/              # UI 主题系统 (colors, typography, spacing)
├── components/         # 通用 UI 组件 (Button, ListItem, MiniPlayer 等)
├── screens/            # 页面层 (HomeScreen, FoldersScreen, PlayerScreen 等)
├── store/              # 状态管理 (Zustand: userStore, settingsStore, playerStore)
├── utils/              # 工具方法 (format, debounce)
└── App.tsx             # 应用入口
```
## 二、 项目总开发步骤
1. **环境与基础搭建**：初始化 React Native 项目，配置 Android 权限（网络、前台服务、唤醒锁），集成 MMKV、Zustand、React Navigation。
2. **核心层 (Core) 实现**：实现 `storage` (MMKV)、`errors` (统一错误)、`rateLimit` (防风控限流)、`http` (Axios 封装)、`wbi` (签名算法)、`cache` (TTL+LRU 缓存)。
3. **服务层 (Services) 实现**：实现 `biliApi` (接口调用)、`transformers` (数据精简)、`cookieService` (鉴权)、`favoriteService` (收藏夹)、`audioService` (音频流获取)。
4. **播放与缓存服务**：集成 `react-native-track-player`，实现 `audioCache` (本地文件缓存) 和 `trackPlayer` (播放队列与后台控制)。
5. **UI 与状态层开发**：实现 `theme` (主题系统)、`store` (全局状态)、`components` (通用组件)，最后完成各 `screens` (页面) 的组装与交互。
6. **打包与发布准备**：配置应用图标、包名、签名密钥（严格保密），配置 `network_security_config.xml` (强制 HTTPS)，实现应用内版本检查机制 (应对 WBI 变更)，构建 Release APK。
## 三、 核心架构约束（纯客户端方案）
1. **禁止引入服务端逻辑**：本项目没有后端服务器。
2. **严格的分层调用**：
   - **UI 层 (`src/screens/`, `src/components/`)**：**绝对禁止**直接引入 `axios` 或直接调用 B 站 API。只能调用 `src/services/` 暴露的方法。
   - **服务层 (`src/services/`)**：负责业务逻辑编排，调用核心层能力。
   - **核心层 (`src/core/`)**：提供底层通用能力。
## 四、 安全与隐私红线（⚠️ 零容忍）
1. **禁止硬编码敏感信息**：
   - **绝对禁止**在代码中硬编码真实的 `Cookie` 或 `SESSDATA`。
   - 测试或占位时，仅允许使用类似 `SESSDATA=YOUR_TOKEN_HERE` 的占位符。
   - 真实 Cookie 必须通过 `cookieService.ts` 动态获取和管理。
2. **严格 HTTPS 与直连**：
   - 网络请求必须直连 B 站官方域名（`*.bilibili.com`, `*.bilivideo.com`, `*.hdslb.com`）。
   - **禁止**在 `network_security_config.xml` 中开启 `cleartextTrafficPermitted="true"`。必须强制全站 HTTPS。
3. **密钥安全**：
   - 绝对禁止将 `bili-music.keystore` 或任何签名密码提交到 Git 仓库。确保它们在 `.gitignore` 中。
## 五、 核心业务逻辑规范
1. **WBI 签名机制**：
   - B 站 API 请求依赖 WBI 签名（`src/core/wbi.ts`）。修改相关逻辑时，必须确保 `mixinKeyEncTab` 数组的完整性（64 个数字）。
   - **版本升级策略**：若 B 站 WBI 算法变更，所有老版本将失效。必须通过修改代码、提升 `versionCode` 并发布新版 APK 来解决。必须实现应用内版本检查机制（读取 GitHub 上的 `version.json`）。
2. **防风控与限流**：
   - 必须遵守客户端软限流策略（`src/core/rateLimit.ts`），默认限制为每秒最多 2 次请求，防止触发 B 站风控导致 IP 被封。
3. **流量与缓存优先**：
   - 默认音质必须设置为 `low`（省流模式）。
   - 音频播放必须优先检查本地缓存（`src/services/audioCache.ts`）。同一首歌曲的二次播放**不应发起任何网络请求**。
4. **后台播放约束**：
   - 必须使用 `react-native-track-player` 处理音频播放，确保应用退到后台或锁屏时音乐能继续播放，并正确响应通知栏控制。
## 六、 UI 与交互规范
1. **设计系统一致性**：
   - 严格使用 `src/theme/` 中定义的颜色（主色 `#FB7299`）、字体大小和间距。
   - 间距采用 **4px 基准网格**（如 4, 8, 12, 16, 20, 28）。
2. **状态反馈**：
   - 所有的网络请求和耗时操作必须有明确的 UI 反馈（Loading 态、Error 态、Empty 态）。
   - 必须处理网络断开的情况，并给出合理提示。
## 七、 错误处理规范
1. **统一错误类型**：
   - 抛出和捕获错误时，必须使用 `src/core/errors.ts` 中定义的标准错误类（如 `NetworkError`, `BiliApiError`, `AuthRequiredError`）。
   - UI 层应根据不同的错误类型（如 `-101` 未登录，`-352` WBI 签名失败）给予用户针对性的引导。