# Nyami Windows Desktop

阶段 0 使用 Electron + React DOM + TypeScript 建立独立桌面入口，阶段 2 已补齐主进程、Preload、Renderer 三层运行时和安全边界，阶段 3 已接入账户、内容 IPC 和基础桌面 UI，阶段 4 已接入真实 HTMLAudio 播放、队列和离线缓存；现有 React Native Android 入口保持不变。

## 开发与构建

```bash
npm run desktop:dev
npm run desktop:typecheck
npm run desktop:build
npm run desktop:package
npm run desktop:release:check
```

`desktop:package` 使用 `desktop/electron-builder.yml` 生成 NSIS 安装包和便携版，目标为 Windows 10 19041+ / Windows 11 x64；构建结束后会在 `release/desktop/` 生成 `latest.json` 和 `SHA256SUMS.txt`。NSIS 使用差分 blockmap 压缩策略，便于后续接入增量更新。

### 阶段 7 发布配置

- 桌面端版本号以 `desktop/package.json` 为唯一来源，当前发布版本为 `1.0.0`。
- 安装包显式使用 `resource/icon.png`，注册 `.nyami` 播放队列文件关联，并启用已有的单实例锁。
- NSIS 使用 assisted installer 和 x64 目标；覆盖升级不会删除 `%APPDATA%/Nyami/`，卸载只清理安装目录和卸载注册信息。
- 构建文件过滤 source map、调试日志、测试目录和测试凭证；`desktop-release.mjs --check` 会校验安装包、便携版、SHA-256 和更新清单。
- 设置页的“检查更新”读取 `NYAMI_UPDATE_URL`。该变量可以是 `latest.json` 地址，也可以是包含 `latest.json` 的 HTTPS 目录；本机开发允许 `http://localhost`。
- 当前更新流程只检查清单并打开已校验的下载地址，用户手动运行安装包完成升级。清单中的 `blockmapUrl` 为后续 `electron-updater` 增量下载保留入口。

### 代码签名

公开发布前在构建环境配置 `CSC_LINK`（或 `WIN_CSC_LINK`）和 `CSC_KEY_PASSWORD`，并让证书发布者与 `win.signtoolOptions.publisherName` 的 `Nyami Project` 一致。未配置证书时仍可生成内部 Alpha 包，但安装器会显示未签名风险，不能视为 Stable 发布。`signExecutable` 已保持开启，electron-builder 会在没有证书时跳过签名；接入证书后无需修改安装器结构。

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

- `desktop/main/runtime/playbackRuntime.ts` 在主进程维护队列、播放模式、分 P 展开、推荐页续接、过期请求 revision、失败重试、网络恢复、睡眠定时器和重启恢复状态。
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

阶段 6 已补齐桌面端 EQ、频谱、托盘、快捷键、媒体键、通知、缓存管理和日志导出；真实 Windows 音频效果、系统媒体键占用情况和通知展示仍需在目标系统手动验收。

## 阶段 5 收藏同步、推荐和本地数据库

- `desktop/main/storage/sqliteDatabase.ts` 使用主进程独占的 Node `node:sqlite`，以 `PRAGMA user_version` 执行事务化前向迁移；迁移失败会回滚当前版本，保留上一版本数据。
- `desktop/main/storage/desktopLibraryRepository.ts` 实现收藏夹元数据、视频关系、同步任务、全局去重索引、视频 tag 缓存和七日推荐历史。每张业务表都带 UID，登录新账号或退出登录时清理旧账号数据。
- `desktop/main/content/desktopLibraryRuntime.ts` 同步自有收藏夹、外部收藏夹和订阅合集，按页断点写入并在同步后有限并发回填 tag；首页推荐通过本地画像、Bilibili 音乐搜索和本地推荐历史生成。
- `desktop/main/runtime/syncRuntime.ts` 将收藏同步、tag 回填、失败重试和取消映射为脱敏进度事件；Renderer 任务面板可以启动、取消和重试同步。
- `content:get-recommendations` 通过 Preload 白名单提供首页个性化视频推荐，完整 Cookie、数据库连接和同步对象仍只在主进程内存在。

阶段 5 已执行 `npm run desktop:typecheck`、`npm run desktop:build` 和 `git diff --check`。真实账号同步、收藏数据量、网络限流、标签接口和 Windows 窗口手动验收仍需在具备 Electron 窗口权限并登录 Bilibili 的环境中完成。

## 阶段 6 EQ、频谱与 Windows 桌面能力

- `desktop/renderer/audio/audioEffectsController.ts` 使用 `AudioWorklet` 承载双声道独立的 RBJ Peaking 滤波器、10 段 Graphic EQ、8 段 PEQ、Limiter 和 1024 点 FFT；参数以完整快照同步，AudioWorklet 失败时回退到 HTMLAudioElement 直通播放。
- `desktop/renderer/audio/fft.ts` 迁移 Android 端的 Hann 窗、Radix-2 FFT、固定 dB 范围和 128 段聚合规则，并保留 44.1 kHz/48 kHz 参考测试向量。
- 设置页保存 EQ 模式、预设、自定义曲线、PEQ 参数、Limiter 阈值和频谱开关；重启后由主进程设置文件恢复，Renderer 初始化后再次同步到音频线程。
- `desktop/main/tray/desktopShell.ts` 接入系统托盘、关闭到托盘、托盘菜单、`CommandOrControl+Alt` 播放快捷键和 `MediaPlayPause`/`MediaNextTrack`/`MediaPreviousTrack` 媒体键；同步完成或失败时发送 Windows 通知。
- 设置页支持缓存摘要、缓存清理、脱敏日志导出；日志导出通过系统保存对话框完成，日志内容继续过滤 Cookie、token、二维码密钥和 URL 查询参数。

### 阶段 6 验证范围

- `npm run desktop:typecheck` 通过。
- `npm run desktop:build` 通过，main、preload 和 renderer 产物均生成。
- `git diff --check` 通过；LF/CRLF 转换提示来自 Windows 工作区属性。
- 尚未在真实 Windows 音频输出、带媒体键键盘、托盘通知中心和登录账号环境完成手动验收；Electron 窗口 ACL 与阶段 5 的真实 Bilibili 数据限制仍然存在。
