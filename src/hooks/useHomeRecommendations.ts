import {useCallback, useEffect} from 'react';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';
import {config} from '../config';
import {generateHomeFeed} from '../services/homeRecommendationService';
import {useAuthStore} from '../store/authStore';
import {useRecommendationStore} from '../store/recommendationStore';
import type {HomeRecommendationFeed} from '../store/recommendationStore';

/** 首页与合集页共用同一份 UID 隔离快照、五小时自动刷新闸门和歌曲分页状态。 */
export function useHomeRecommendations() {
  const uid = useAuthStore(state => state.userId);
  const isFocused = useIsFocused();
  const feed: HomeRecommendationFeed = useRecommendationStore(state =>
    uid
      ? state.feedsByUid[uid] ?? state.getFeed(uid)
      : state.getFeed(''),
  );
  const refreshing = useRecommendationStore(state => !!uid && state.refreshingUid === uid);
  const lastSuccessfulRefreshAt = useRecommendationStore(state =>
    uid ? state.lastSuccessfulRefreshAtByUid[uid] ?? 0 : 0,
  );

  const refresh = useCallback(async (mode: 'automatic' | 'manual') => {
    if (!uid) return false;
    const store = useRecommendationStore.getState();
    const started = mode === 'automatic'
      ? store.tryBeginAutomaticRefresh(uid, Date.now())
      : store.beginManualRefresh(uid);
    if (!started) return false;

    try {
      const generated = await generateHomeFeed(uid, new AbortController().signal);
      useRecommendationStore.getState().finishRefresh(uid, generated);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '刷新推荐失败';
      useRecommendationStore.getState().failRefresh(uid, message);
      return false;
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      void refresh('automatic');
    }, [refresh]),
  );

  useEffect(() => {
    if (!uid || !isFocused || !lastSuccessfulRefreshAt) return undefined;
    const refreshDueAt = lastSuccessfulRefreshAt + config.recommendations.homeRefreshIntervalMs;
    const timer = setTimeout(
      () => void refresh('automatic'),
      Math.max(0, refreshDueAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [uid, isFocused, lastSuccessfulRefreshAt, refresh]);

  return {uid, feed, refreshing, refresh};
}
