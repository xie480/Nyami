import {create} from 'zustand';
import {createJSONStorage, persist, StateStorage} from 'zustand/middleware';
import {config} from '../config';
import {storage} from '../core/storage';
import type {CollectionRecommendation, TagRecommendation} from '../types/domain';

/**
 * 按 B 站 UID 保存发现页推荐快照，并用上次成功刷新时间控制自动刷新频率。
 * 仅推荐数据和成功刷新时间持久化；运行中的 loading 标记在进程重启后自动复位。
 */
export interface HomeRecommendationFeed {
  collections: CollectionRecommendation[];
  /** 是否还有未触发七日去重的合集；可选以兼容历史持久化快照。 */
  collectionsHasMore?: boolean;
  songs: TagRecommendation[];
  songPage: number;
  songHasMore: boolean;
  failedSearchCount: number;
  updatedAt: number | null;
  error: string | null;
}

export const EMPTY_HOME_RECOMMENDATION_FEED: HomeRecommendationFeed = {
  collections: [],
  collectionsHasMore: false,
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
  lastSuccessfulRefreshAtByUid: Record<string, number>;
  refreshingUid: string | null;
  refreshSequence: number;
  getFeed: (uid: string) => HomeRecommendationFeed;
  tryBeginAutomaticRefresh: (uid: string, now: number) => number | null;
  beginManualRefresh: (uid: string) => number | null;
  finishRefresh: (uid: string, sequence: number, feed: HomeRecommendationFeed) => void;
  failRefresh: (uid: string, sequence: number, error: string) => void;
}

export const useRecommendationStore = create<RecommendationState>()(
  persist(
    (set, get) => ({
      feedsByUid: {},
      lastSuccessfulRefreshAtByUid: {},
      refreshingUid: null,
      refreshSequence: 0,
      getFeed: uid => get().feedsByUid[uid] ?? EMPTY_HOME_RECOMMENDATION_FEED,
      tryBeginAutomaticRefresh: (uid, now) => {
        const state = get();
        const lastRefreshAt = state.lastSuccessfulRefreshAtByUid[uid] ?? 0;
        if (
          !uid ||
          now - lastRefreshAt < config.recommendations.homeRefreshIntervalMs ||
          state.refreshingUid === uid
        ) {
          return null;
        }
        const sequence = state.refreshSequence + 1;
        set({refreshingUid: uid, refreshSequence: sequence});
        return sequence;
      },
      beginManualRefresh: uid => {
        const state = get();
        if (!uid) return null;
        const sequence = state.refreshSequence + 1;
        set({refreshingUid: uid, refreshSequence: sequence});
        return sequence;
      },
      finishRefresh: (uid, sequence, feed) =>
        set(state => {
          if (state.refreshingUid !== uid || state.refreshSequence !== sequence) {
            return state;
          }
          const updatedAt = feed.updatedAt ?? Date.now();
          const refreshedFeed = {...feed, updatedAt};
          return {
            feedsByUid: {...state.feedsByUid, [uid]: refreshedFeed},
            lastSuccessfulRefreshAtByUid: {
              ...state.lastSuccessfulRefreshAtByUid,
              [uid]: updatedAt,
            },
            refreshingUid: null,
          };
        }),
      failRefresh: (uid, sequence, error) =>
        set(state => {
          if (state.refreshingUid !== uid || state.refreshSequence !== sequence) {
            return state;
          }
          const previous = state.feedsByUid[uid] ?? EMPTY_HOME_RECOMMENDATION_FEED;
          return {
            feedsByUid: {
              ...state.feedsByUid,
              [uid]: {...previous, error},
            },
            refreshingUid: null,
          };
        }),
    }),
    {
      name: 'homeRecommendationStore',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: state => ({
        feedsByUid: state.feedsByUid,
        lastSuccessfulRefreshAtByUid: state.lastSuccessfulRefreshAtByUid,
      }),
    },
  ),
);
