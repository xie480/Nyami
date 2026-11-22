import type {AuthStatus, SyncPhase, SyncSnapshot, SyncStartRequest} from '../../shared/types';
import type {CredentialStore} from '../auth/credentialStore';
import {DesktopLibraryRuntime} from '../content/desktopLibraryRuntime';
import type {AppLogger} from '../logging/appLogger';

const DEFAULT_SYNC_SNAPSHOT: SyncSnapshot = {
  state: 'idle',
  taskId: null,
  completed: 0,
  total: 0,
  phase: 'idle',
  uid: null,
  processedVideos: 0,
  totalVideos: 0,
  skippedTasks: 0,
  failedTasks: 0,
  message: null,
  canRetry: false,
  startedAt: null,
  finishedAt: null,
  error: null,
};

type SyncListener = (snapshot: SyncSnapshot) => void;

/**
 * 主进程收藏同步任务运行时。
 * 负责任务生命周期、取消、失败重试和脱敏进度事件，不把 API 或数据库对象暴露给 Renderer。
 */
export class SyncRuntime {
  private snapshot: SyncSnapshot = {
    ...DEFAULT_SYNC_SNAPSHOT,
  };

  private readonly listeners = new Set<SyncListener>();

  private controller: AbortController | null = null;

  private runningPromise: Promise<void> | null = null;

  /**
   * 创建同步运行时。
   * @param credentials 主进程凭证存储
   * @param library 收藏索引业务运行时
   * @param logger 脱敏日志器
   */
  constructor(
    private readonly credentials: CredentialStore,
    private readonly library: DesktopLibraryRuntime,
    private readonly logger: AppLogger,
  ) {}

  /** 读取当前同步状态快照。 */
  getStatus(): SyncSnapshot {
    return this.clone();
  }

  /** 订阅进度变化，供 IPC 转发给当前 Renderer。 */
  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 启动一次全量或断点同步；重复启动只返回当前任务快照。 */
  start(request: SyncStartRequest = {}): Promise<SyncSnapshot> {
    if (this.snapshot.state === 'running') {
      return Promise.resolve(this.clone());
    }
    const taskId = `sync-${Date.now()}`;
    const startedAt = Date.now();
    this.snapshot = {
      ...DEFAULT_SYNC_SNAPSHOT,
      state: 'running',
      taskId,
      phase: 'catalog',
      startedAt,
      message: request.force ? '正在准备全量同步' : '正在准备收藏同步',
    };
    this.controller = new AbortController();
    this.emit();
    this.runningPromise = this.execute(
      taskId,
      request.force === true,
      request.automatic === true,
      request.sourceKeys,
    ).finally(() => {
      this.runningPromise = null;
      this.controller = null;
    });
    return Promise.resolve(this.clone());
  }

  /** 请求取消当前同步，正在进行的网络请求会通过 AbortSignal 结束。 */
  async cancel(): Promise<SyncSnapshot> {
    if (this.snapshot.state !== 'running') {
      return this.clone();
    }
    const running = this.runningPromise;
    this.controller?.abort();
    this.snapshot = {
      ...this.snapshot,
      state: 'cancelled',
      canRetry: true,
      message: '正在取消同步',
      finishedAt: Date.now(),
    };
    this.emit();
    if (running) {
      await running;
    }
    return this.clone();
  }

  /** 窗口销毁时取消任务并释放事件监听。 */
  dispose(): void {
    this.controller?.abort();
    this.listeners.clear();
  }

  /** 执行真实收藏同步并把阶段性进度映射到桌面快照。 */
  private async execute(
    taskId: string,
    force: boolean,
    automatic: boolean,
    sourceKeys?: readonly string[],
  ): Promise<void> {
    let status: AuthStatus;
    try {
      status = await this.credentials.getStatus();
      if (!status.loggedIn || !status.uid) {
        throw new Error('请先登录 Bilibili 账号再同步收藏');
      }
      if (automatic && !this.library.hasLocalIndex(status.uid)) {
        this.snapshot = {
          ...DEFAULT_SYNC_SNAPSHOT,
          uid: status.uid,
          message: '首次登录请手动执行收藏同步',
        };
        this.emit();
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        uid: status.uid,
        message: force ? '正在执行全量收藏同步' : '正在同步收藏目录',
      };
      this.emit();
      const controller = this.controller;
      if (!controller) {
        throw new Error('同步任务控制器不存在');
      }
      await this.library.synchronize(status.uid, {
        force,
        sourceKeys,
        signal: controller.signal,
        onPhase: (phase, total) => {
          this.updatePhase(phase, total);
        },
        onFavoriteProgress: progress => {
          this.snapshot = {
            ...this.snapshot,
            phase: 'favorites',
            completed: progress.completedTasks,
            total: progress.totalTasks,
            processedVideos: progress.processedVideos,
            totalVideos: progress.totalVideos,
            skippedTasks: progress.skippedTasks,
            failedTasks: progress.failedTasks,
            message: `收藏同步 ${progress.completedTasks}/${progress.totalTasks}`,
          };
          this.emit();
        },
      });
      if (controller.signal.aborted || this.snapshot.state === 'cancelled') {
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        state: 'completed',
        phase: 'completed',
        canRetry: false,
        message: '收藏索引同步完成',
        finishedAt: Date.now(),
        error: null,
      };
      this.emit();
    } catch (error) {
      const cancelled =
        this.controller?.signal.aborted ||
        this.snapshot.state === 'cancelled' ||
        isAbortError(error);
      if (cancelled) {
        if (this.snapshot.state !== 'cancelled') {
          this.snapshot = {
            ...this.snapshot,
            state: 'cancelled',
            canRetry: true,
            message: '同步已取消',
            finishedAt: Date.now(),
          };
          this.emit();
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('sync.failed', {
        taskId,
        error,
      });
      this.snapshot = {
        ...this.snapshot,
        state: 'failed',
        canRetry: true,
        message: '收藏同步失败，可重试',
        error: message.slice(0, 500),
        finishedAt: Date.now(),
      };
      this.emit();
    }
  }

  /** 更新同步阶段，并保留可供任务面板显示的总量。 */
  private updatePhase(
    phase: Exclude<SyncPhase, 'idle' | 'completed'>,
    total: number,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      phase,
      total: Math.max(0, Math.floor(total)),
    };
    this.emit();
  }

  /** 向所有订阅者发送独立快照副本。 */
  private emit(): void {
    const snapshot = this.clone();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /** 返回独立的状态对象，避免 IPC 调用方修改主进程状态。 */
  private clone(): SyncSnapshot {
    return {
      ...this.snapshot,
    };
  }
}

/** 判断网络请求或共享任务是否因取消而结束。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.message.includes('已取消')
  );
}
