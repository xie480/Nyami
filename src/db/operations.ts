import { database, globalVideoCollection, syncMetaCollection } from './database';
import { Q } from '@nozbe/watermelondb';
import type { FavoriteVideo, FolderSyncMeta } from '../types/domain';

/**
 * 插入或更新一条全局视频记录。
 * 若 bvid 已存在则更新，否则创建。
 */
export async function upsertGlobalVideo(video: FavoriteVideo): Promise<void> {
  await database.write(async writer => {
    const existing = await globalVideoCollection.query(
      Q.where('bvid', video.bvid),
    ).fetch();
    if (existing.length > 0) {
      const record = existing[0];
      // Merge existing folderIds with incoming ones
      const existingFolderIds: number[] = (() => {
        try { return JSON.parse(record.folderIds || '[]'); } catch { return []; }
      })();
      const incomingFolderIds: number[] = video.folderIds || [];
      const mergedFolderIds = [...new Set([...existingFolderIds, ...incomingFolderIds])];
      
      await record.update(r => {
        r.title = video.title;
        r.cover = video.cover;
        r.duration = video.duration;
        r.page = video.page;
        r.pubtime = video.pubtime;
        r.upperMid = video.upper.mid;
        r.upperName = video.upper.name;
        r.attr = video.attr;
        r.folderIds = JSON.stringify(mergedFolderIds);
        r.parts = JSON.stringify(video.parts || []);
      });
    } else {
      await globalVideoCollection.create(r => {
        r.bvid = video.bvid;
        r.title = video.title;
        r.cover = video.cover;
        r.duration = video.duration;
        r.page = video.page;
        r.pubtime = video.pubtime;
        r.upperMid = video.upper.mid;
        r.upperName = video.upper.name;
        r.attr = video.attr;
        r.folderIds = JSON.stringify(video.folderIds || []);
        r.parts = JSON.stringify(video.parts || []);
      });
    }
  });
}

/**
 * 批量插入或更新全局视频记录（事务性）。
 */
export async function batchUpsertGlobalVideos(videos: FavoriteVideo[]): Promise<void> {
  if (videos.length === 0) return;

  await database.write(async writer => {
    const bvids = videos.map(v => v.bvid);
    const existingRecords = await globalVideoCollection.query(
      Q.where('bvid', Q.oneOf(bvids))
    ).fetch();

    const existingMap = new Map<string, GlobalVideo>();
    for (const record of existingRecords) {
      existingMap.set(record.bvid, record);
    }

    const batchOperations: any[] = [];

    for (const video of videos) {
      const record = existingMap.get(video.bvid);
      if (record) {
        // Merge existing folderIds with incoming ones
        const existingFolderIds: number[] = (() => {
          try { return JSON.parse(record.folderIds || '[]'); } catch { return []; }
        })();
        const incomingFolderIds: number[] = video.folderIds || [];
        const mergedFolderIds = [...new Set([...existingFolderIds, ...incomingFolderIds])];
        
        batchOperations.push(
          record.prepareUpdate(r => {
            r.title = video.title;
            r.cover = video.cover;
            r.duration = video.duration;
            r.page = video.page;
            r.pubtime = video.pubtime;
            r.upperMid = video.upper.mid;
            r.upperName = video.upper.name;
            r.attr = video.attr;
            r.folderIds = JSON.stringify(mergedFolderIds);
            r.parts = JSON.stringify(video.parts || []);
          })
        );
      } else {
        batchOperations.push(
          globalVideoCollection.prepareCreate(r => {
            r.bvid = video.bvid;
            r.title = video.title;
            r.cover = video.cover;
            r.duration = video.duration;
            r.page = video.page;
            r.pubtime = video.pubtime;
            r.upperMid = video.upper.mid;
            r.upperName = video.upper.name;
            r.attr = video.attr;
            r.folderIds = JSON.stringify(video.folderIds || []);
            r.parts = JSON.stringify(video.parts || []);
          })
        );
      }
    }

    await writer.batch(...batchOperations);
  });
}

/**
 * 读取全局索引（所有视频）。
 */
export async function getGlobalIndex(): Promise<FavoriteVideo[]> {
  const records = await globalVideoCollection.query().fetch();
  return records.map(r => ({
    bvid: r.bvid,
    title: r.title,
    cover: r.cover,
    duration: r.duration,
    page: r.page,
    pubtime: r.pubtime,
    upper: { mid: r.upperMid, name: r.upperName },
    attr: r.attr,
    folderIds: JSON.parse(r.folderIds || '[]'),
    parts: r.parts ? JSON.parse(r.parts) : undefined,
  }));
}

/**
 * 根据 folderId 获取属于该收藏夹的所有视频。
 * 通过解析 folder_ids JSON 字段过滤。
 */
export async function getVideosByFolderId(folderId: number): Promise<FavoriteVideo[]> {
  const all = await getGlobalIndex();
  return all.filter(v => v.folderIds?.includes(folderId));
}

/**
 * 获取某个收藏夹的同步元数据。
 */
export async function getSyncMeta(folderId: number): Promise<FolderSyncMeta | null> {
  const results = await syncMetaCollection.query(
    Q.where('folder_id', folderId),
  ).fetch();
  if (results.length === 0) return null;
  const meta = results[0];
  return {
    folderId: meta.folderId,
    lastSyncTime: meta.lastSyncTime ? meta.lastSyncTime.getTime() : 0,
    latestBvid: meta.latestBvid,
    mediaCount: meta.mediaCount,
    needsFullSync: !!meta.needsFullSync,
    lastSyncedPage: meta.lastSyncedPage,
  };
}

/**
 * 更新或插入单个收藏夹的同步元数据。
 */
export async function updateSyncMeta(meta: FolderSyncMeta): Promise<void> {
  await database.write(async writer => {
    const results = await syncMetaCollection.query(
      Q.where('folder_id', meta.folderId),
    ).fetch();
    
    const syncTime = new Date(meta.lastSyncTime);
    
    if (results.length > 0) {
      await results[0].update(r => {
        r.lastSyncTime = syncTime;
        r.latestBvid = meta.latestBvid;
        r.mediaCount = meta.mediaCount;
        r.needsFullSync = meta.needsFullSync || false;
        r.lastSyncedPage = meta.lastSyncedPage || null;
      });
    } else {
      await syncMetaCollection.create(r => {
        r.folderId = meta.folderId;
        r.lastSyncTime = syncTime;
        r.latestBvid = meta.latestBvid;
        r.mediaCount = meta.mediaCount;
        r.needsFullSync = meta.needsFullSync || false;
        r.lastSyncedPage = meta.lastSyncedPage || null;
      });
    }
  });
}

/**
 * 获取所有同步元数据，以 folder_id 为键的映射。
 */
export async function getAllSyncMetaMap(): Promise<Record<number, FolderSyncMeta>> {
  const records = await syncMetaCollection.query().fetch();
  const map: Record<number, FolderSyncMeta> = {};
  for (const r of records) {
    map[r.folderId] = {
      folderId: r.folderId,
      lastSyncTime: r.lastSyncTime ? r.lastSyncTime.getTime() : 0,
      latestBvid: r.latestBvid,
      mediaCount: r.mediaCount,
      needsFullSync: !!r.needsFullSync,
      lastSyncedPage: r.lastSyncedPage,
    };
  }
  return map;
}

/**
 * 从所有包含该 folderId 的视频记录中移除该 folderId。
 * 若移除后 folderIds 为空，则删除该记录。
 * 用于全量同步前清除旧数据。
 */
export async function removeFolderIdFromAllVideos(folderId: number): Promise<void> {
  // 先读取所有包含该 folderId 的视频（在写事务外读取）
  const allVideos = await getGlobalIndex();
  const affectedBvids = allVideos.filter(v => v.folderIds?.includes(folderId)).map(v => v.bvid);

  if (affectedBvids.length === 0) return;

  await database.write(async writer => {
    const records = await globalVideoCollection.query(
      Q.where('bvid', Q.oneOf(affectedBvids))
    ).fetch();

    const batchOperations: any[] = [];
    
    for (const record of records) {
      const currentFolderIds: number[] = (() => {
        try { return JSON.parse(record.folderIds || '[]'); } catch { return []; }
      })();
      const newFolderIds = currentFolderIds.filter(id => id !== folderId);
      if (newFolderIds.length === 0) {
        batchOperations.push(record.prepareMarkAsDeleted());
      } else {
        batchOperations.push(
          record.prepareUpdate(r => {
            r.folderIds = JSON.stringify(newFolderIds);
          })
        );
      }
    }
    await writer.batch(...batchOperations);
  });
}

/**
 * 清除所有索引数据和同步元数据。
 */
export async function clearAllIndexes(): Promise<void> {
  await database.write(async writer => {
    await globalVideoCollection.query().markAllAsDeleted();
    await syncMetaCollection.query().markAllAsDeleted();
  });
}
