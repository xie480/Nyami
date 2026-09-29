import {Q} from '@nozbe/watermelondb';
import {config} from '../config';
import {
  database,
  recommendationFilterCollection,
} from '../db/database';
import {RecommendationFilter} from '../db/models/RecommendationFilter';
import {normalizeRecommendationTitleKey} from './tagRecommendationService';
import type {CollectionRecommendation, TagRecommendation} from '../types/domain';

interface FilteredRecommendations {
  videos: TagRecommendation[];
  collections: CollectionRecommendation[];
  collectionsHasMore: boolean;
}

interface RecommendationMinimumFillOptions {
  minimumVideos?: number;
  minimumCollections?: number;
  allowRecentRepeats?: boolean;
}

/** 按账号过滤 7 日内已推荐条目，并原子写入本轮新推荐的 ID 与视频名。 */
export async function filterAndRecordRecommendations(
  uid: string,
  videos: TagRecommendation[],
  collections: CollectionRecommendation[],
  maxCollections = config.recommendations.homePlaylistLimit,
  signal?: AbortSignal,
  minimumFill: RecommendationMinimumFillOptions = {},
): Promise<FilteredRecommendations> {
  if (!uid) return {videos: [], collections: [], collectionsHasMore: false};
  const now = Date.now();
  const expiresAt = now + config.recommendations.recommendationHistoryTtlMs;

  return database.write(async writer => {
    const records = await recommendationFilterCollection
      .query(Q.where('uid', uid))
      .fetch();
    if (signal?.aborted) {
      return {videos: [], collections: [], collectionsHasMore: false};
    }
    const expired = records.filter(record => record.expiresAt <= now);
    if (expired.length > 0) {
      await writer.batch(...expired.map(record => record.prepareDestroyPermanently()));
    }

    const active = records.filter(record => record.expiresAt > now);
    const activeVideoRecords = active.filter(record => record.itemType === 'video');
    const activeCollectionRecords = active.filter(record => record.itemType === 'collection');
    const activeVideoIds = new Map(
      activeVideoRecords.map(record => [record.itemId, record] as const),
    );
    const activeVideoTitles = new Map(
      activeVideoRecords
        .filter(record => record.titleKey)
        .map(record => [record.titleKey as string, record] as const),
    );
    const activeCollectionIds = new Map(
      activeCollectionRecords.map(record => [record.itemId, record] as const),
    );
    const filteredVideos: TagRecommendation[] = [];
    const filteredCollections: CollectionRecommendation[] = [];
    const writes: RecommendationFilter[] = [];
    const selectedVideoIds = new Set<string>();
    const selectedVideoTitles = new Set<string>();
    const selectedCollectionIds = new Set<string>();
    let collectionsHasMore = false;
    const minimumVideos = Math.max(0, Math.floor(minimumFill.minimumVideos ?? 0));
    const minimumCollections = Math.min(
      Math.max(0, Math.floor(minimumFill.minimumCollections ?? 0)),
      Math.max(0, maxCollections),
    );

    for (const video of videos) {
      const itemId = video.bvid.trim();
      const titleKey = normalizeRecommendationTitleKey(video.title);
      if (
        !itemId ||
        activeVideoIds.has(itemId) ||
        (titleKey && activeVideoTitles.has(titleKey)) ||
        selectedVideoIds.has(itemId) ||
        (titleKey && selectedVideoTitles.has(titleKey))
      ) {
        continue;
      }
      selectedVideoIds.add(itemId);
      if (titleKey) {
        selectedVideoTitles.add(titleKey);
      }
      filteredVideos.push(video);
      writes.push(recommendationFilterCollection.prepareCreate(record => {
        record.uid = uid;
        record.itemType = 'video';
        record.itemId = itemId;
        record.titleKey = titleKey || null;
        record.expiresAt = expiresAt;
      }));
    }

    if (
      minimumFill.allowRecentRepeats &&
      filteredVideos.length < minimumVideos
    ) {
      const extendedRecordIds = new Set<string>();
      for (const video of videos) {
        if (filteredVideos.length >= minimumVideos) {
          break;
        }
        const itemId = video.bvid.trim();
        const titleKey = normalizeRecommendationTitleKey(video.title);
        if (
          !itemId ||
          selectedVideoIds.has(itemId) ||
          (titleKey && selectedVideoTitles.has(titleKey))
        ) {
          continue;
        }
        const existingRecord = activeVideoIds.get(itemId) ??
          (titleKey ? activeVideoTitles.get(titleKey) : undefined);
        if (!existingRecord) {
          continue;
        }
        selectedVideoIds.add(itemId);
        if (titleKey) {
          selectedVideoTitles.add(titleKey);
        }
        filteredVideos.push(video);
        if (!extendedRecordIds.has(existingRecord.id)) {
          extendedRecordIds.add(existingRecord.id);
          writes.push(existingRecord.prepareUpdate(record => {
            record.expiresAt = expiresAt;
          }));
        }
      }
    }

    for (const collection of collections) {
      const itemId = collection.sourceKey.trim();
      if (
        !itemId ||
        activeCollectionIds.has(itemId) ||
        selectedCollectionIds.has(itemId)
      ) {
        continue;
      }
      if (filteredCollections.length >= maxCollections) {
        collectionsHasMore = true;
        break;
      }
      selectedCollectionIds.add(itemId);
      filteredCollections.push(collection);
      writes.push(recommendationFilterCollection.prepareCreate(record => {
        record.uid = uid;
        record.itemType = 'collection';
        record.itemId = itemId;
        record.titleKey = null;
        record.expiresAt = expiresAt;
      }));
    }

    if (
      minimumFill.allowRecentRepeats &&
      filteredCollections.length < minimumCollections
    ) {
      for (const collection of collections) {
        if (filteredCollections.length >= minimumCollections) {
          break;
        }
        const itemId = collection.sourceKey.trim();
        if (!itemId || selectedCollectionIds.has(itemId)) {
          continue;
        }
        const existingRecord = activeCollectionIds.get(itemId);
        if (!existingRecord) {
          continue;
        }
        selectedCollectionIds.add(itemId);
        filteredCollections.push(collection);
        writes.push(existingRecord.prepareUpdate(record => {
          record.expiresAt = expiresAt;
        }));
      }
    }

    if (signal?.aborted) {
      return {videos: [], collections: [], collectionsHasMore: false};
    }
    if (writes.length > 0) await writer.batch(...writes);
    return {
      videos: filteredVideos,
      collections: filteredCollections,
      collectionsHasMore,
    };
  });
}

/** 播放队列分页同样遵守近期推荐历史。 */
export async function filterAndRecordRecommendedVideos(
  uid: string,
  videos: TagRecommendation[],
): Promise<TagRecommendation[]> {
  const filtered = await filterAndRecordRecommendations(uid, videos, []);
  return filtered.videos;
}
