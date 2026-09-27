import {create} from 'zustand';
import {createJSONStorage, persist, StateStorage} from 'zustand/middleware';
import {storage} from '../core/storage';
import type {CollectionRecommendation, TagRecommendation} from '../types/domain';

/**
 * 按 B 站 UID 保存发现页推荐快照，并在发起日常请求前记录日期，避免页面聚焦导致重复请求。
 * 仅推荐数据和自动触发日期持久化；运行中的 loading 标记在进程重启后自动复位。
 */
export interface HomeRecommendationFeed {
  collections: CollectionRecommendation[];
  songs: TagRecommendation[];
  songPage: number;
  songHasMore: boolean;
  failedSearchCount: number;
  updatedAt: number | null;
  error: string | null;
}

export const EMPTY_HOME_RECOMMENDATION_FEED: HomeRecommendationFeed = {
  collections: [],
  songs: [],
  songPage: 0,
  songHasMore: false,
  failedSearchCount: 0,
  updatedAt: null,
  error: null,
};

const mmkvStorage: StateStorage = {
  getItem: name => storage.getString(name) ?? null,
  setItem: (name, value) => storage.setString(name, value),
  removeItem: name => storage.delete(name),
};

interface RecommendationState {
  feedsByUid: Record<string, HomeRecommendationFeed>;
  lastAutoRefreshDateByUid: Record<string, string>;
  refreshingUid: string | null;
  getFeed: (uid: string) => HomeRecommendationFeed;
  tryBeginDailyRefresh: (uid: string, date: string) => boolean;
  beginManualRefresh: (uid: string, date: string) => boolean;
  finishRefresh: (uid: string, date: string, feed: HomeRecommendationFeed) => void;
  failRefresh: (uid: string, error: string) => void;
}

export const useRecommendationStore = create<RecommendationState>()(
  persist(
    (set, get) => ({
      feedsByUid: {},
      lastAutoRefreshDateByUid: {},
      refreshingUid: null,
      getFeed: uid => get().feedsByUid[uid] ?? EMPTY_HOME_RECOMMENDATION_FEED,
      tryBeginDailyRefresh: (uid, date) => {
        const state = get();
        if (
          !uid ||
          state.lastAutoRefreshDateByUid[uid] === date ||
          state.refreshingUid !== null
        ) {
          return false;
        }
        set(state => ({
          lastAutoRefreshDateByUid: {
            ...state.lastAutoRefreshDateByUid,
            [uid]: date,
          },
          refreshingUid: uid,
        }));
        return true;
      },
      beginManualRefresh: (uid, date) => {
        const state = get();
        if (!uid || state.refreshingUid !== null) return false;
        set(state => ({
          lastAutoRefreshDateByUid: {
            ...state.lastAutoRefreshDateByUid,
            [uid]: date,
          },
          refreshingUid: uid,
        }));
        return true;
      },
      finishRefresh: (uid, date, feed) =>
        set(state => ({
          feedsByUid: {...state.feedsByUid, [uid]: feed},
          lastAutoRefreshDateByUid: {
            ...state.lastAutoRefreshDateByUid,
            [uid]: date,
          },
          refreshingUid: state.refreshingUid === uid ? null : state.refreshingUid,
        })),
      failRefresh: (uid, error) =>
        set(state => {
          const previous = state.feedsByUid[uid] ?? EMPTY_HOME_RECOMMENDATION_FEED;
          return {
            feedsByUid: {
              ...state.feedsByUid,
              [uid]: {...previous, error},
            },
            refreshingUid: state.refreshingUid === uid ? null : state.refreshingUid,
          };
        }),
    }),
    {
      name: 'homeRecommendationStore',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: state => ({
        feedsByUid: state.feedsByUid,
        lastAutoRefreshDateByUid: state.lastAutoRefreshDateByUid,
      }),
    },
  ),
);
