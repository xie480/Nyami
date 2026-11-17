# Nyami Windows v1.0.0

## 发布内容

- 提供 Windows x64 NSIS 安装包和便携版。
- 安装器注册 `.nyami` 播放队列文件关联，并保留 `%APPDATA%/Nyami/` 用户数据。
- 发布脚本生成 `latest.json`、`SHA256SUMS.txt` 和 NSIS blockmap 引用，支持配置更新源进行手动升级。
- 发行构建默认关闭 source map，排除调试日志、测试凭证和测试目录。

## 已知限制

- 当前版本的更新检查只负责读取清单并打开下载地址，安装仍由用户手动确认。
- 未配置 `CSC_LINK` / `WIN_CSC_LINK` 时构建包保持未签名，公开发布前需要接入代码签名证书。
- Windows 10/11 安装、覆盖升级、回滚和卸载数据保留仍需在目标系统完成手动验收。
