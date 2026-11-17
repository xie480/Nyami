import {app} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';

/**
 * Windows 桌面端的应用数据目录集合。
 * 所有路径都从 Electron userData 派生，避免把用户目录或盘符写入代码。
 */
export type AppDirectories = {
  root: string;
  db: string;
  cache: string;
  audioCache: string;
  imageCache: string;
  logs: string;
  settings: string;
  lock: string;
};

const APP_DIRECTORY_NAMES = {
  db: 'db',
  cache: 'cache',
  audioCache: path.join('cache', 'audio'),
  imageCache: path.join('cache', 'images'),
  logs: 'logs',
  settings: 'settings',
  lock: 'lock',
} as const;

/**
 * 解析当前应用的数据目录。
 * @param root 可选根目录，测试或迁移工具可传入临时目录
 * @returns 完整的应用数据目录集合
 */
export function getAppDirectories(root = app.getPath('userData')): AppDirectories {
  return {
    root,
    db: path.join(root, APP_DIRECTORY_NAMES.db),
    cache: path.join(root, APP_DIRECTORY_NAMES.cache),
    audioCache: path.join(root, APP_DIRECTORY_NAMES.audioCache),
    imageCache: path.join(root, APP_DIRECTORY_NAMES.imageCache),
    logs: path.join(root, APP_DIRECTORY_NAMES.logs),
    settings: path.join(root, APP_DIRECTORY_NAMES.settings),
    lock: path.join(root, APP_DIRECTORY_NAMES.lock),
  };
}

/**
 * 创建应用运行所需的目录。
 * @param directories 目标目录集合
 * @returns 所有目录创建完成后的 Promise
 */
export async function ensureAppDirectories(
  directories: AppDirectories,
): Promise<void> {
  await Promise.all(
    [
      directories.root,
      directories.db,
      directories.cache,
      directories.audioCache,
      directories.imageCache,
      directories.logs,
      directories.settings,
      directories.lock,
    ].map(directory => fs.mkdir(directory, {recursive: true})),
  );
}

/**
 * 判断目标路径是否位于指定目录内。
 * @param target 待判断路径
 * @param parent 允许的父目录
 * @returns 是否处于父目录及其子目录中
 */
export function isPathInside(target: string, parent: string): boolean {
  const normalizedTarget = path.resolve(target);
  const normalizedParent = path.resolve(parent);
  const relative = path.relative(normalizedParent, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
