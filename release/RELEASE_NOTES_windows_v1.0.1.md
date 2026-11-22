# NYAMI Windows v1.0.1

## 修复内容

- 修复安装包主进程未内联 `md5` 和 `qrcode` 依赖，安装后启动时报 `Cannot find module 'md5'` 的问题。
- 保持 Windows x64 NSIS 安装方式、用户数据目录和快捷方式配置不变。

## 已知限制

- 更新检查仍只读取清单并打开下载地址，安装需要用户手动确认。
- 当前构建未配置 Windows 代码签名证书。
