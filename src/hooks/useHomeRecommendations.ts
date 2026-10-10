import {useCallback, useEffect} from 'react';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';
import {generateHomeFeed} from '../services/homeRecommendationService';
import {useAuthStore} from '../store/authStore';
import {useRecommendationStore} from '../store/recommendationStore';
import type {HomeRecommendationFeed} from '../store/recommendationStore';
import {useSettingsStore} from '../store/settingsStore';
import {useNetworkRecoveryRefresh} from './useNetworkRecoveryRefresh';

let activeRecommendationRefresh: {
  uid: string;
  controller: AbortController;
} | null = null;

/** 首页与合集页共用一份 UID 隔离快照、可配置的自动刷新闸门和歌曲分页状态。 */
export function useHomeRecommendations() {
  const uid = useAuthStore(state => state.userId);
  const isFocused = useIsFocused();
  const homeRefreshMode = useSettingsStore(state => state.homeRefreshMode);
  const homeRefreshIntervalHours = useSettingsStore(state => state.homeRefreshIntervalHours);
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
    if (!uid) {
      return false;
    }
    const settings = useSettingsStore.getState();
    if (mode === 'automatic' && settings.homeRefreshMode !== 'automatic') {
      return false;
    }
    const store = useRecommendationStore.getState();
    const started = mode === 'automatic'
      ? store.tryBeginAutomaticRefresh(
          uid,
          Date.now(),
          settings.homeRefreshIntervalHours * 60 * 60 * 1000,
        )
      : store.beginManualRefresh(uid);
    if (started === null) {
      return false;
    }
    if (activeRecommendationRefresh && (
      mode === 'manual' || activeRecommendationRefresh.uid !== uid
    )) {
      activeRecommendationRefresh.controller.abort();
    }

    const controller = new AbortController();
    activeRecommendationRefresh = {uid, controller};

    try {
      const generated = await generateHomeFeed(uid, controller.signal);
      useRecommendationStore.getState().finishRefresh(uid, started, generated);
      return !controller.signal.aborted;
    } catch (error) {
      if (controller.signal.aborted) {
        return false;
      }
      const message = error instanceof Error ? error.message : '刷新推荐失败';
      useRecommendationStore.getState().failRefresh(uid, started, message);
      return false;
    } finally {
      if (activeRecommendationRefresh?.controller === controller) {
        activeRecommendationRefresh = null;
      }
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      if (homeRefreshMode === 'automatic') {
        void refresh('automatic');
      }
    }, [homeRefreshMode, refresh]),
  );

  useEffect(() => {
    if (
      !uid ||
      !isFocused ||
      homeRefreshMode !== 'automatic' ||
      !lastSuccessfulRefreshAt
    ) {
      return undefined;
    }
    const refreshDueAt =
      lastSuccessfulRefreshAt + homeRefreshIntervalHours * 60 * 60 * 1000;
    const timer = setTimeout(
      () => void refresh('automatic'),
      Math.max(0, refreshDueAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [
    uid,
    isFocused,
    homeRefreshMode,
    homeRefreshIntervalHours,
    lastSuccessfulRefreshAt,
    refresh,
  ]);

  useNetworkRecoveryRefresh(
    () => refresh('automatic'),
    Boolean(uid && feed.error && !refreshing),
  );

  return {
    uid,
    feed,
    refreshing,
    refresh,
    homeRefreshMode,
    homeRefreshIntervalHours,
  };
}
