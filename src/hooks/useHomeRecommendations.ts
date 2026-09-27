import {useCallback} from 'react';
import {generateHomeFeed} from '../services/homeRecommendationService';
import {useAuthStore} from '../store/authStore';
import {useRecommendationStore} from '../store/recommendationStore';
import type {HomeRecommendationFeed} from '../store/recommendationStore';

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 首页与合集页共用同一份 UID 隔离快照、每日触发闸门和歌曲分页状态。 */
export function useHomeRecommendations() {
  const uid = useAuthStore(state => state.userId);
  const feed: HomeRecommendationFeed = useRecommendationStore(state =>
    uid
      ? state.feedsByUid[uid] ?? state.getFeed(uid)
      : state.getFeed(''),
  );
  const refreshing = useRecommendationStore(state => !!uid && state.refreshingUid === uid);

  const refresh = useCallback(async (mode: 'daily' | 'manual') => {
    if (!uid) return false;
    const date = getLocalDateKey();
    const store = useRecommendationStore.getState();
    const started = mode === 'daily'
      ? store.tryBeginDailyRefresh(uid, date)
      : store.beginManualRefresh(uid, date);
    if (!started) return false;

    try {
      const generated = await generateHomeFeed(uid, new AbortController().signal);
      useRecommendationStore.getState().finishRefresh(uid, date, generated);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '刷新推荐失败';
      useRecommendationStore.getState().failRefresh(uid, message);
      return false;
    }
  }, [uid]);

  return {uid, feed, refreshing, refresh};
}
