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
        await task();
      } catch (e) {
        console.warn(`[TaskQueue] Task failed:`, e);
      }
    }
    this.running--;
    this.process();
  }
}
