export class TaskQueue {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private concurrency: number) {}

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task());
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    this.running++;
    const task = this.queue.shift();
    if (task) {
      try {
        // 任务级超时兜底，防止单个任务永久阻塞（默认 60 秒）
        const timeoutMs = 60000; // 60 秒
        await Promise.race([
          task(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Task timeout')), timeoutMs)),
        ]);
      } catch (e) {
        // 记录超时或其他错误，但不影响后续任务执行
        console.warn(`[TaskQueue] Task failed or timed out: ${e?.message}`);
      }
    }
    this.running--;
    this.process();
  }
}
