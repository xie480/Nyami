import { MMKV } from 'react-native-mmkv';
import type { FolderSyncMeta, FavoriteVideo } from '../types/domain';

const mmkv = new MMKV({ id: 'bili-music' });

export { mmkv };

export const storage = {
  getString: (k: string) => mmkv.getString(k),
  setString: (k: string, v: string) => mmkv.set(k, v),
  getBool:   (k: string) => mmkv.getBoolean(k),
  setBool:   (k: string, v: boolean) => mmkv.set(k, v),
  getNumber: (k: string) => mmkv.getNumber(k),
  setNumber: (k: string, v: number) => mmkv.set(k, v),
  getJSON<T>(k: string): T | null {
    const s = mmkv.getString(k);
    if (!s) return null;
    try { return JSON.parse(s) as T; } catch { return null; }
  },
  setJSON: (k: string, v: any) => mmkv.set(k, JSON.stringify(v)),
  delete:  (k: string) => mmkv.delete(k),
  contains:(k: string) => mmkv.contains(k),
  getAllKeys: () => mmkv.getAllKeys(),
  /** 删除所有以 prefix 开头的 key */
  deletePrefix: (prefix: string) => {
    for (const k of mmkv.getAllKeys()) {
      if (k.startsWith(prefix)) mmkv.delete(k);
    }
  },

  // ─── 增量同步元数据存取 ───────────────────────────────
  /** 获取所有收藏夹的同步元数据 */
  getSyncMetaMap(): Record<number, FolderSyncMeta> {
    return this.getJSON<Record<number, FolderSyncMeta>>('syncMetaMap') || {};
  },

  /** 覆盖写入全部同步元数据（原子性保存） */
  setSyncMetaMap(map: Record<number, FolderSyncMeta>): void {
    this.setJSON('syncMetaMap', map);
  },

  /** 更新单个收藏夹的同步元数据（读-改-写，保证不丢失其他文件夹的元数据） */
  updateSyncMeta(folderId: number, meta: FolderSyncMeta): void {
    const map = this.getSyncMetaMap();
    map[folderId] = meta;
    this.setSyncMetaMap(map);
  },

  /** 删除单个收藏夹的同步元数据 */
  deleteSyncMeta(folderId: number): void {
    const map = this.getSyncMetaMap();
    delete map[folderId];
    this.setSyncMetaMap(map);
  },

  /** 清除全部同步元数据（恢复全量同步状态） */
  clearSyncMeta(): void {
    this.delete('syncMetaMap');
  },

  // ─── 全局索引分片存储 ───────────────────────────────
  /** 获取单个收藏夹的索引分片 */
  getFolderIndex(folderId: number): FavoriteVideo[] {
    return this.getJSON<FavoriteVideo[]>(`folderIndex:${folderId}`) || [];
  },

  /** 写入单个收藏夹的索引分片 */
  setFolderIndex(folderId: number, videos: FavoriteVideo[]): void {
    this.setJSON(`folderIndex:${folderId}`, videos);
  },

  /** 删除单个收藏夹的索引分片 */
  deleteFolderIndex(folderId: number): void {
    this.delete(`folderIndex:${folderId}`);
  },

  /** 获取所有已存储分片的收藏夹 ID 列表 */
  getAllIndexedFolderIds(): number[] {
    const prefix = 'folderIndex:';
    return mmkv.getAllKeys()
      .filter(k => k.startsWith(prefix))
      .map(k => parseInt(k.slice(prefix.length), 10))
      .filter(id => !isNaN(id));
  },

  /**
   * 从所有分片重建全局索引缓存（去重、合并 folderIds）。
   * 仅在同步完成后调用一次，避免频繁全量序列化阻塞 JS 线程。
   */
  rebuildGlobalCache(): void {
    const folderIds = this.getAllIndexedFolderIds();
    const videoMap = new Map<string, FavoriteVideo>();

    for (const folderId of folderIds) {
      const videos = this.getFolderIndex(folderId);
      for (const v of videos) {
        if (!videoMap.has(v.bvid)) {
          videoMap.set(v.bvid, { ...v, folderIds: [folderId] });
        } else {
          const existing = videoMap.get(v.bvid)!;
          if (!existing.folderIds) existing.folderIds = [];
          if (!existing.folderIds.includes(folderId)) {
            existing.folderIds.push(folderId);
          }
          existing.title = v.title;
          existing.cover = v.cover;
          existing.duration = v.duration;
          existing.pubtime = v.pubtime;
          existing.upper = v.upper;
          existing.attr = v.attr;
        }
      }
    }

    this.setJSON('globalIndex', Array.from(videoMap.values()));
  },

  /** 读取缓存的全局索引（轻量操作，MMKV getString 同步调用） */
  getGlobalIndexCached(): FavoriteVideo[] {
    return this.getJSON<FavoriteVideo[]>('globalIndex') || [];
  },

  /** 清除全部分片数据及全局缓存 */
  clearAllIndexes(): void {
    this.delete('globalIndex');
    this.deletePrefix('folderIndex:');
  },
};
