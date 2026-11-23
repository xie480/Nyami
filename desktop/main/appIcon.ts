import {app} from 'electron';
import {existsSync} from 'node:fs';
import path from 'node:path';

const DESKTOP_ICON_RELATIVE_PATH = path.join('resource', 'icon.ico');

/** 返回桌面端运行时使用的品牌图标路径，兼容开发环境和打包环境。 */
export function getDesktopIconPath(): string {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, DESKTOP_ICON_RELATIVE_PATH),
        path.join(app.getAppPath(), DESKTOP_ICON_RELATIVE_PATH),
      ]
    : [
        path.join(app.getAppPath(), DESKTOP_ICON_RELATIVE_PATH),
        path.join(process.cwd(), DESKTOP_ICON_RELATIVE_PATH),
      ];
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
}
