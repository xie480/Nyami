# Nyami Windows Spike

阶段 0 使用 Electron + React DOM + TypeScript 建立独立桌面入口，现有 React Native Android 入口保持不变。

## 开发与构建

```bash
npm run desktop:dev
npm run desktop:typecheck
npm run desktop:build
npm run desktop:package
```

`desktop:package` 使用 `desktop/electron-builder.yml` 生成 NSIS 安装包和便携版，目标为 Windows 10 19041+ / Windows 11 x64。

## 验证面板

- **登录与 WebContentsView**：主进程生成二维码并轮询，Renderer 不接收二维码轮询密钥；扫码成功后由主进程打开受控 Bilibili `WebContentsView`，读取 Cookie 后使用 Electron `safeStorage` 保存。
- **音频与离线播放**：粘贴 Bilibili CDN 音频 URL，验证 `Referer`、`User-Agent`、Range 响应和过期 URL 重取；播放器同时支持仓库固定 WAV 样例与用户本地文件。

阶段 0 不实现完整播放器、SQLite Repository 或移动端共享核心；这些内容按 `WINDOWS_DESKTOP_PLAN.md` 在后续阶段迁移。
