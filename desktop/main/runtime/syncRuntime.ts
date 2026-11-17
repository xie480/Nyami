import type {SyncSnapshot} from '../../shared/types';

const DEFAULT_SYNC_SNAPSHOT: SyncSnapshot = {
  state: 'idle',
  taskId: null,
  completed: 0,
  total: 0,
  error: null,
};

/**
 * 阶段 2 的同步任务状态适配器。
 * 具体 Bilibili 收藏同步留给阶段 5，当前先提供可观察、可取消的 IPC 状态。
 */
export class SyncRuntime {
  private snapshot: SyncSnapshot = {
    ...DEFAULT_SYNC_SNAPSHOT,
  };

  /**
   * 获取同步状态。
   * @returns 同步状态快照
   */
  getStatus(): SyncSnapshot {
    return this.clone();
  }

  /**
   * 创建一个可取消的同步任务状态。
   * @returns 同步状态快照
   */
  start(): SyncSnapshot {
    if (this.snapshot.state === 'running') {
      return this.clone();
    }
    this.snapshot = {
      state: 'running',
      taskId: `sync-${Date.now()}`,
      completed: 0,
      total: 0,
      error: null,
    };
    return this.clone();
  }

  /**
   * 取消当前同步任务。
   * @returns 更新后的同步状态快照
   */
  cancel(): SyncSnapshot {
    if (this.snapshot.state === 'running') {
      this.snapshot = {
        ...this.snapshot,
        state: 'cancelled',
      };
    }
    return this.clone();
  }

  /**
   * 返回独立状态副本。
   * @returns 同步状态副本
   */
  private clone(): SyncSnapshot {
    return {
      ...this.snapshot,
    };
  }
}
