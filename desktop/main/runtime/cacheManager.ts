import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {CacheSummary} from '../../shared/types';
import type {AppDirectories} from '../storage/appDirectories';
import type {AudioCacheStore} from './audioCacheStore';

/**
 * 桌面音频和图片缓存目录管理器。
 * 所有清理操作都在 app.getPath('userData') 派生目录内执行。
 */
export class CacheManager {
  /**
   * 创建缓存管理器。
   * @param directories 应用数据目录
   */
  constructor(
    private readonly directories: AppDirectories,
    private readonly audioCache?: AudioCacheStore,
  ) {}

  /**
   * 扫描缓存目录并返回脱敏摘要。
   * @returns 缓存大小和文件数量
   */
  async getSummary(): Promise<CacheSummary> {
    const [audio, images] = await Promise.all([
      this.scanDirectory(this.directories.audioCache),
      this.scanDirectory(this.directories.imageCache),
    ]);
    return {
      audioBytes: audio.bytes,
      imageBytes: images.bytes,
      fileCount: audio.files + images.files,
      updatedAt: Date.now(),
    };
  }

  /**
   * 清空音频和图片缓存目录中的内容。
   * @returns 清理完成后的缓存摘要
   */
  async clear(): Promise<CacheSummary> {
    await Promise.all([
      this.audioCache
        ? this.audioCache.clear()
        : this.clearDirectory(this.directories.audioCache),
      this.clearDirectory(this.directories.imageCache),
    ]);
    return this.getSummary();
  }

  /**
   * 递归计算目录大小和文件数量。
   * @param directory 待扫描目录
   * @returns 目录统计
   */
  private async scanDirectory(
    directory: string,
  ): Promise<{bytes: number; files: number}> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, {withFileTypes: true});
    } catch {
      return {bytes: 0, files: 0};
    }
    let bytes = 0;
    let files = 0;
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.scanDirectory(entryPath);
        bytes += nested.bytes;
        files += nested.files;
        continue;
      }
      try {
        const stat = await fs.stat(entryPath);
        bytes += stat.size;
        files += 1;
      } catch {
        // 文件可能在扫描期间被清理，忽略这一项即可。
      }
    }
    return {bytes, files};
  }

  /**
   * 删除指定缓存目录中的子项并保留目录本身。
   * @param directory 待清理目录
   * @returns 清理完成后的 Promise
   */
  private async clearDirectory(directory: string): Promise<void> {
    await fs.mkdir(directory, {recursive: true});
    const entries = await fs.readdir(directory, {withFileTypes: true});
    await Promise.all(
      entries.map(entry => fs.rm(path.join(directory, entry.name), {recursive: true, force: true})),
    );
  }
}
