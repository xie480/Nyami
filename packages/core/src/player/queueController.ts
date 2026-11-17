export type QueueMode = 'sequential' | 'shuffle';

export type QueuePart = {
  cid: number;
  page: number;
  title: string;
  duration: number;
};

export type QueueItem = {
  bvid: string;
  queueId?: string;
  parts?: QueuePart[];
};

export type QueueSnapshot<TItem extends QueueItem> = {
  queue: TItem[];
  originalQueue: TItem[];
  currentBvid: string | null;
  mode: QueueMode;
  context: unknown;
};

type QueueControllerOptions<TItem extends QueueItem> = {
  idOf?: (item: TItem) => string;
  random?: () => number;
};

/**
 * 与平台播放器无关的播放队列控制器。
 * 负责去重、顺序/随机模式、分 P 展开和异步操作 revision 守卫。
 */
export class QueueController<TItem extends QueueItem> {
  private readonly idOf: (item: TItem) => string;

  private readonly random: () => number;

  private revision = 0;

  private snapshot: QueueSnapshot<TItem> = {
    queue: [],
    originalQueue: [],
    currentBvid: null,
    mode: 'sequential',
    context: null,
  };

  private readonly listeners = new Set<
    (snapshot: QueueSnapshot<TItem>) => void
  >();

  constructor(options: QueueControllerOptions<TItem> = {}) {
    this.idOf = options.idOf ?? (item => item.queueId ?? item.bvid);
    this.random = options.random ?? Math.random;
  }

  /** 返回当前队列 revision，供平台异步操作做过期判断。 */
  getRevision(): number {
    return this.revision;
  }

  /** 开始一次新的队列操作并返回其 revision。 */
  beginOperation(): number {
    this.revision += 1;
    return this.revision;
  }

  /** 判断一个异步操作是否仍对应最新队列。 */
  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }

  /** 返回不可变队列快照。 */
  getSnapshot(): QueueSnapshot<TItem> {
    return {
      ...this.snapshot,
      queue: [...this.snapshot.queue],
      originalQueue: [...this.snapshot.originalQueue],
    };
  }

  /** 订阅队列变化，供移动端 Store 和桌面 Renderer 适配。 */
  subscribe(listener: (snapshot: QueueSnapshot<TItem>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 同步外部 Store 的状态，不推进 revision。 */
  syncSnapshot(
    queue: TItem[],
    currentBvid?: string | null,
    context?: unknown,
  ): void {
    const normalized = this.unique(queue);
    const current =
      currentBvid &&
      normalized.some(
        item => this.idOf(item) === currentBvid || item.bvid === currentBvid,
      )
        ? currentBvid
        : normalized[0] ? this.idOf(normalized[0]) : null;
    this.snapshot = {
      ...this.snapshot,
      queue: normalized,
      originalQueue: [...normalized],
      currentBvid: current,
      context: context === undefined ? this.snapshot.context : context,
    };
    this.emit();
  }

  /** 替换队列并返回新 revision。 */
  replaceQueue(
    queue: TItem[],
    currentBvid?: string | null,
    context?: unknown,
  ): number {
    const revision = this.beginOperation();
    this.syncSnapshot(queue, currentBvid, context);
    return revision;
  }

  /** 只更新当前播放顺序，保留顺序模式基线。 */
  setCurrentQueue(queue: TItem[], currentBvid?: string | null): void {
    const normalized = this.unique(queue);
    const current = currentBvid ?? this.snapshot.currentBvid;
    this.snapshot = {
      ...this.snapshot,
      queue: normalized,
      currentBvid:
        current &&
        normalized.some(
          item => this.idOf(item) === current || item.bvid === current,
        )
          ? current
          : normalized[0] ? this.idOf(normalized[0]) : null,
    };
    this.emit();
  }

  /** 在队列末尾追加项目，并保留当前播放项。 */
  append(items: TItem[]): number {
    const revision = this.beginOperation();
    const normalized = this.unique([...this.snapshot.queue, ...items]);
    const current = this.snapshot.currentBvid;
    this.snapshot = {
      ...this.snapshot,
      queue: normalized,
      originalQueue:
        this.snapshot.mode === 'sequential'
          ? [...normalized]
          : this.snapshot.originalQueue,
      currentBvid:
        current &&
        normalized.some(
          item => this.idOf(item) === current || item.bvid === current,
        )
          ? current
          : normalized[0] ? this.idOf(normalized[0]) : null,
    };
    this.emit();
    return revision;
  }

  /** 在当前播放项后插入一首歌。 */
  insertNext(item: TItem): number {
    const revision = this.beginOperation();
    const nextQueue = this.snapshot.queue.filter(
      queueItem => this.idOf(queueItem) !== this.idOf(item),
    );
    const currentIndex = nextQueue.findIndex(
      queueItem =>
        this.idOf(queueItem) === this.snapshot.currentBvid ||
        queueItem.bvid === this.snapshot.currentBvid,
    );
    nextQueue.splice(currentIndex < 0 ? 0 : currentIndex + 1, 0, item);
    this.snapshot = {
      ...this.snapshot,
      queue: nextQueue,
      originalQueue: this.snapshot.originalQueue,
    };
    this.emit();
    return revision;
  }

  /** 从队列移除指定项目。 */
  remove(itemId: string): number {
    const revision = this.beginOperation();
    const nextQueue = this.snapshot.queue.filter(
      item => this.idOf(item) !== itemId && item.bvid !== itemId,
    );
    this.snapshot = {
      ...this.snapshot,
      queue: nextQueue,
      originalQueue: this.snapshot.originalQueue.filter(
        item => this.idOf(item) !== itemId && item.bvid !== itemId,
      ),
      currentBvid: nextQueue.some(
        item =>
          this.idOf(item) === this.snapshot.currentBvid ||
          item.bvid === this.snapshot.currentBvid,
      )
        ? this.snapshot.currentBvid
        : nextQueue[0] ? this.idOf(nextQueue[0]) : null,
    };
    this.emit();
    return revision;
  }

  /** 替换当前播放顺序，顺序模式下同步更新基线。 */
  reorder(queue: TItem[], currentBvid?: string | null): number {
    const revision = this.beginOperation();
    const normalized = this.unique(queue);
    this.snapshot = {
      ...this.snapshot,
      queue: normalized,
      originalQueue:
        this.snapshot.mode === 'sequential'
          ? [...normalized]
          : this.snapshot.originalQueue,
      currentBvid:
        currentBvid &&
        normalized.some(
          item => this.idOf(item) === currentBvid || item.bvid === currentBvid,
        )
          ? currentBvid
          : this.snapshot.currentBvid,
    };
    this.emit();
    return revision;
  }

  /** 切换顺序/随机播放，随机模式会保持当前播放项位于首位。 */
  setMode(mode: QueueMode): number {
    const revision = this.beginOperation();
    const baseline =
      this.snapshot.originalQueue.length > 0
        ? this.snapshot.originalQueue
        : this.snapshot.queue;
    let queue = [...baseline];
    if (mode === 'shuffle') {
      const currentIndex = queue.findIndex(
        item =>
          this.idOf(item) === this.snapshot.currentBvid ||
          item.bvid === this.snapshot.currentBvid,
      );
      const current =
        currentIndex >= 0 ? queue.splice(currentIndex, 1)[0] : null;
      this.shuffle(queue);
      if (current) {
        queue.unshift(current);
      }
    }
    this.snapshot = {
      ...this.snapshot,
      queue,
      originalQueue: [...baseline],
      mode,
    };
    this.emit();
    return revision;
  }

  /** 返回当前播放项的下一项，不改变状态。 */
  next(): TItem | null {
    const index = this.findCurrentIndex();
    return index >= 0 ? this.snapshot.queue[index + 1] ?? null : null;
  }

  /** 返回当前播放项的上一项，不改变状态。 */
  previous(): TItem | null {
    const index = this.findCurrentIndex();
    return index > 0 ? this.snapshot.queue[index - 1] : null;
  }

  /** 执行带 revision 守卫的异步队列操作，过期结果会被丢弃。 */
  async runLatest<TResult>(
    operation: (revision: number) => Promise<TResult>,
  ): Promise<TResult | undefined> {
    const revision = this.beginOperation();
    const result = await operation(revision);
    return this.isCurrent(revision) ? result : undefined;
  }

  private unique(queue: TItem[]): TItem[] {
    const byId = new Map<string, TItem>();
    for (const item of queue) {
      const id = this.idOf(item);
      if (id && !byId.has(id)) {
        byId.set(id, item);
      }
    }
    return Array.from(byId.values());
  }

  private shuffle(queue: TItem[]): void {
    for (let index = queue.length - 1; index > 0; index -= 1) {
      const target = Math.floor(this.random() * (index + 1));
      [queue[index], queue[target]] = [queue[target], queue[index]];
    }
  }

  /** 根据队列项目 ID 或 BVID 查找当前项，兼容多 P 的 queueId。 */
  private findCurrentIndex(): number {
    return this.snapshot.queue.findIndex(
      item =>
        this.idOf(item) === this.snapshot.currentBvid ||
        item.bvid === this.snapshot.currentBvid,
    );
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach(listener => listener(snapshot));
  }
}

/**
 * 将带有分 P 信息的视频展开为播放器队列项。
 * 未开启分 P 或接口没有返回 parts 时保持原视频对象和顺序。
 */
export function expandVideoParts<T extends QueueItem>(
  videos: T[],
  enabled: boolean,
): Array<T & {queueId?: string; cid?: number}> {
  if (!enabled) {
    return [...videos];
  }

  return videos.flatMap(video => {
    const parts = video.parts ?? [];
    if (parts.length <= 1) {
      return [video];
    }
    return parts.map(part => ({
      ...video,
      queueId: `${video.bvid}:p${part.page}`,
      cid: part.cid,
      page: part.page,
      title: part.title,
      duration: part.duration,
    })) as Array<T & {queueId?: string; cid?: number}>;
  });
}
