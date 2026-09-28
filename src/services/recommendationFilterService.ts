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
}

/** 按账号过滤 7 日内已推荐条目，并原子写入本轮新推荐的 ID 与视频名。 */
export async function filterAndRecordRecommendations(
  uid: string,
  videos: TagRecommendation[],
  collections: CollectionRecommendation[],
  maxCollections = config.recommendations.homePlaylistLimit,
): Promise<FilteredRecommendations> {
  if (!uid) return {videos: [], collections: []};
  const now = Date.now();
  const expiresAt = now + config.recommendations.recommendationHistoryTtlMs;

  return database.write(async writer => {
    const records = await recommendationFilterCollection
      .query(Q.where('uid', uid))
      .fetch();
    const expired = records.filter(record => record.expiresAt <= now);
    if (expired.length > 0) {
      await writer.batch(...expired.map(record => record.prepareDestroyPermanently()));
    }

    const active = records.filter(record => record.expiresAt > now);
    const seenVideoIds = new Set(
      active.filter(record => record.itemType === 'video').map(record => record.itemId),
    );
    const seenVideoTitles = new Set(
      active
        .filter(record => record.itemType === 'video' && record.titleKey)
        .map(record => record.titleKey as string),
    );
    const seenCollectionIds = new Set(
      active.filter(record => record.itemType === 'collection').map(record => record.itemId),
    );
    const filteredVideos: TagRecommendation[] = [];
    const filteredCollections: CollectionRecommendation[] = [];
    const writes: RecommendationFilter[] = [];

    for (const video of videos) {
      const itemId = video.bvid.trim();
      const titleKey = normalizeRecommendationTitleKey(video.title);
      if (!itemId || seenVideoIds.has(itemId) || (titleKey && seenVideoTitles.has(titleKey))) {
        continue;
      }
      seenVideoIds.add(itemId);
      if (titleKey) seenVideoTitles.add(titleKey);
      filteredVideos.push(video);
      writes.push(recommendationFilterCollection.prepareCreate(record => {
        record.uid = uid;
        record.itemType = 'video';
        record.itemId = itemId;
        record.titleKey = titleKey || null;
        record.expiresAt = expiresAt;
      }));
    }

    for (const collection of collections) {
      if (filteredCollections.length >= maxCollections) break;
      const itemId = collection.sourceKey.trim();
      if (!itemId || seenCollectionIds.has(itemId)) continue;
      seenCollectionIds.add(itemId);
      filteredCollections.push(collection);
      writes.push(recommendationFilterCollection.prepareCreate(record => {
        record.uid = uid;
        record.itemType = 'collection';
        record.itemId = itemId;
        record.titleKey = null;
        record.expiresAt = expiresAt;
      }));
    }

    if (writes.length > 0) await writer.batch(...writes);
    return {videos: filteredVideos, collections: filteredCollections};
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
