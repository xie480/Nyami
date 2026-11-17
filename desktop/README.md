# Nyami Windows Desktop

阶段 0 使用 Electron + React DOM + TypeScript 建立独立桌面入口，阶段 2 已补齐主进程、Preload、Renderer 三层运行时和安全边界；现有 React Native Android 入口保持不变。

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

## 验证面板

- **登录与 WebContentsView**：主进程生成二维码并轮询，Renderer 不接收二维码轮询密钥；扫码成功后由主进程打开受控 Bilibili `WebContentsView`，读取 Cookie 后使用 Electron `safeStorage` 保存。
- **音频与离线播放**：粘贴 Bilibili CDN 音频 URL，验证 `Referer`、`User-Agent`、Range 响应和过期 URL 重取；播放器同时支持仓库固定 WAV 样例与用户本地文件。

阶段 0 不实现完整播放器、SQLite Repository 或移动端共享核心；这些内容按 `WINDOWS_DESKTOP_PLAN.md` 在后续阶段迁移。
