import {create} from 'zustand';
import type {TagBackfillProgress} from '../services/tagRecommendationService';

type TagBackfillStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

interface TagBackfillState {
  uid: string | null;
  status: TagBackfillStatus;
  progress: TagBackfillProgress;
  error: string | null;
  begin: (uid: string, totalVideoCount: number) => void;
  setTotalVideoCount: (uid: string, totalVideoCount: number) => void;
  updateProgress: (uid: string, progress: TagBackfillProgress) => void;
  finish: (uid: string, status: TagBackfillStatus, error?: string | null) => void;
}

const EMPTY_PROGRESS: TagBackfillProgress = {
  totalVideoCount: 0,
  completedVideoCount: 0,
  successfulVideoCount: 0,
  emptyVideoCount: 0,
  failedVideoCount: 0,
  paused: false,
};

/** 仅保存当前进程中的后台提取进度；标签快照和重试时间持久化在 WatermelonDB。 */
export const useTagBackfillStore = create<TagBackfillState>((set, get) => ({
  uid: null,
  status: 'idle',
  progress: EMPTY_PROGRESS,
  error: null,
  begin: (uid, totalVideoCount) =>
    set({
      uid,
      status: 'running',
      error: null,
      progress: {...EMPTY_PROGRESS, totalVideoCount},
    }),
  setTotalVideoCount: (uid, totalVideoCount) =>
    set(state => state.uid === uid
      ? {progress: {...state.progress, totalVideoCount}}
      : state),
  updateProgress: (uid, progress) =>
    set(state => state.uid === uid
      ? {progress}
      : state),
  finish: (uid, status, error = null) => {
    if (get().uid !== uid) {
      return;
    }
    set({status, error});
  },
}));
