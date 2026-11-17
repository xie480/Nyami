# Nyami Windows Desktop

阶段 0 使用 Electron + React DOM + TypeScript 建立独立桌面入口，阶段 2 已补齐主进程、Preload、Renderer 三层运行时和安全边界，阶段 3 已接入账户、内容 IPC 和基础桌面 UI；现有 React Native Android 入口保持不变。

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

阶段 2 的播放和同步接口目前只承载状态契约；真实 HTMLAudio 播放器和 Bilibili 同步分别按方案在阶段 4、阶段 5 接入。

## 阶段 3 账户、搜索与基础桌面 UI

- Renderer 使用侧边栏、主内容区、右侧任务通知和底部播放器占位组成桌面布局，支持深色、浅色、玻璃和跟随系统主题。
- 认证入口支持二维码登录、受控网页登录、Cookie 续期、登录状态、账号资料和退出登录；完整 Cookie 与 refresh token 仍只在主进程处理。
- 内容入口支持公开首页、发现、站内搜索、收藏夹目录和收藏视频分页；未登录可以浏览公开内容，收藏夹在登录后解锁。
- 搜索、发现和收藏视频请求都带 `requestId`，支持取消、分页、加载、空状态、错误重试和任务通知，不阻塞 Renderer 主窗口。
- `Ctrl+K` 聚焦搜索，播放器控制保留上一首、播放/暂停、下一首入口；真实音频播放和队列逻辑留在阶段 4。

阶段 3 的主进程实现位于 `desktop/main/auth/` 与 `desktop/main/content/`，跨进程契约位于 `desktop/shared/types.ts`，Preload 只暴露白名单 API。

### 阶段 3 验证范围

- `npm run desktop:typecheck` 通过。
- `npm run desktop:build` 通过，生成 main、preload 和 renderer 产物。
- 使用本地模拟主进程 API 通过桌面浏览器检查了 1366×768、1920×1080 布局，以及搜索分页、登录二维码弹窗、未登录收藏夹引导和登录后收藏目录。
- 当前工作区启动真实 Electron 窗口仍受 `node_modules/electron/dist` 缺少 `ALL APPLICATION PACKAGES` 读取 ACL 影响，未修改系统 ACL；真实账号登录和 Bilibili 网络数据仍需在具备窗口权限的 Windows 环境补验。

## 验证面板

- **登录与 WebContentsView**：主进程生成二维码并轮询，Renderer 不接收二维码轮询密钥；扫码成功后由主进程打开受控 Bilibili `WebContentsView`，读取 Cookie 后使用 Electron `safeStorage` 保存。
- **音频与离线播放**：粘贴 Bilibili CDN 音频 URL，验证 `Referer`、`User-Agent`、Range 响应和过期 URL 重取；播放器同时支持仓库固定 WAV 样例与用户本地文件。

阶段 0 不实现完整播放器、SQLite Repository 或移动端共享核心；这些内容按 `WINDOWS_DESKTOP_PLAN.md` 在后续阶段迁移。
