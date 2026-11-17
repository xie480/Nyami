# Nyami Windows Desktop

阶段 0 使用 Electron + React DOM + TypeScript 建立独立桌面入口，阶段 2 已补齐主进程、Preload、Renderer 三层运行时和安全边界，阶段 3 已接入账户、内容 IPC 和基础桌面 UI，阶段 4 已接入真实 HTMLAudio 播放、队列和离线缓存；现有 React Native Android 入口保持不变。

## 开发与构建

```bash
npm run desktop:dev
npm run desktop:typecheck
npm run desktop:build
npm run desktop:package
```

`desktop:package` 使用 `desktop/electron-builder.yml` 生成 NSIS 安装包和便携版，目标为 Windows 10 19041+ / Windows 11 x64。

## 阶段 2 运行时

- 主窗口启用 `contextIsolation`、`sandbox`、`nodeIntegration: false`、CSP 和单实例锁。
- Preload 通过 `contextBridge` 暴露类型化的认证、播放、同步、缓存、设置和日志 API。
- 主进程在 `%APPDATA%/Nyami/` 对应的 Electron `userData` 目录下管理 `db`、`cache`、`logs`、`settings` 和 `lock` 子目录。
- 未捕获主进程异常和 Renderer 错误边界都会写入脱敏本地日志。

阶段 2 的播放和同步接口已经由阶段 4 的主进程播放器运行时承载。收藏同步和本地数据库仍按方案留在阶段 5。

## 阶段 3 账户、搜索与基础桌面 UI

- Renderer 使用侧边栏、主内容区、右侧任务通知和底部播放器占位组成桌面布局，支持深色、浅色、玻璃和跟随系统主题。
- 认证入口支持二维码登录、受控网页登录、Cookie 续期、登录状态、账号资料和退出登录；完整 Cookie 与 refresh token 仍只在主进程处理。
- 内容入口支持公开首页、发现、站内搜索、收藏夹目录和收藏视频分页；未登录可以浏览公开内容，收藏夹在登录后解锁。
- 搜索、发现和收藏视频请求都带 `requestId`，支持取消、分页、加载、空状态、错误重试和任务通知，不阻塞 Renderer 主窗口。
- `Ctrl+K` 聚焦搜索；内容卡片可以立即播放或加入队列，底部播放器支持上一首、播放/暂停、下一首、进度、音量、随机/顺序模式和睡眠定时器。

阶段 3 的主进程实现位于 `desktop/main/auth/` 与 `desktop/main/content/`，跨进程契约位于 `desktop/shared/types.ts`，Preload 只暴露白名单 API。

### 阶段 3 验证范围

- `npm run desktop:typecheck` 通过。
- `npm run desktop:build` 通过，生成 main、preload 和 renderer 产物。
- 使用本地模拟主进程 API 通过桌面浏览器检查了 1366×768、1920×1080 布局，以及搜索分页、登录二维码弹窗、未登录收藏夹引导和登录后收藏目录。
- 当前工作区启动真实 Electron 窗口仍受 `node_modules/electron/dist` 缺少 `ALL APPLICATION PACKAGES` 读取 ACL 影响，未修改系统 ACL；真实账号登录和 Bilibili 网络数据仍需在具备窗口权限的 Windows 环境补验。

## 阶段 4 播放器、队列与离线缓存

- `desktop/main/runtime/playbackRuntime.ts` 在主进程维护队列、播放模式、分 P 展开、过期请求 revision、失败重试、网络恢复、睡眠定时器和重启恢复状态。
- `desktop/renderer/audio/electronAudioPlayer.ts` 将 `HTMLAudioElement` 适配为共享 `AudioPlayer` 契约，处理媒体事件、进度、音量和淡入淡出；Renderer 不解析 Bilibili 播放地址。
- `desktop/main/audio/biliAudioResolver.ts` 复用共享 WBI/API 和主进程凭证，按 DASH/durl 音频质量选择地址，并在主进程校验 Bilibili CDN 域名。
- `desktop/main/runtime/audioCacheStore.ts` 使用 BVID、CID 和音质生成缓存键，下载写入临时文件后原子重命名，再以原子索引记录大小、MIME、创建时间和最近访问时间；缓存满载时按 LRU 淘汰非队列项目。
- `nyami-cache://audio/` 处理器限制缓存键和应用数据目录，提供 `HEAD`、Range 和流式响应，支持断网拖动进度。
- 播放错误分为请求头、URL 过期、解码、磁盘、断网和通用播放错误，并通过脱敏诊断信息展示给 Renderer。

### 阶段 4 验证范围

- `npm run desktop:typecheck` 通过。
- `npm run desktop:build` 通过，生成 main、preload 和 renderer 产物。
- `git diff --check` 通过；未运行真实 Bilibili 播放、断网和重启手动验收，当前环境仍受 Electron 目录 ACL 限制。

## 验证面板

- **登录与 WebContentsView**：主进程生成二维码并轮询，Renderer 不接收二维码轮询密钥；扫码成功后由主进程打开受控 Bilibili `WebContentsView`，读取 Cookie 后使用 Electron `safeStorage` 保存。
- **音频与离线播放**：阶段 4 已实现主进程带 `Referer`、`User-Agent` 的音频解析和下载、Range 响应、过期 URL 重取、缓存优先播放以及断网诊断；真实 CDN 行为仍需在具备窗口权限的 Windows 环境补验。

阶段 4 不实现完整收藏同步、SQLite Repository、EQ、频谱和系统媒体键；这些内容按 `WINDOWS_DESKTOP_PLAN.md` 在后续阶段迁移。
