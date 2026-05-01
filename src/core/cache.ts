import { storage } from './storage';

interface Entry<T> {
  value: T;
  expireAt: number;
  lastAccess: number;
}

class TTLCache {
  private mem = new Map<string, Entry<any>>();
  private readonly maxEntries = 200; // 内存中最多 200 条

  /** 内存读取 */
  private getMem<T>(key: string): T | undefined {
    const e = this.mem.get(key);
    if (!e) return undefined;
    if (e.expireAt < Date.now()) {
      this.mem.delete(key);
      return undefined;
    }
    e.lastAccess = Date.now();
    return e.value as T;
  }

  /** 内存写入（含 LRU 淘汰）*/
  private setMem<T>(key: string, value: T, ttl: number) {
    if (this.mem.size >= this.maxEntries) {
      // 淘汰最久未访问的
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [k, v] of this.mem) {
        if (v.lastAccess < oldestTime) {
          oldestTime = v.lastAccess;
          oldestKey = k;
        }
      }
      if (oldestKey) this.mem.delete(oldestKey);
    }
    this.mem.set(key, {
      value,
      expireAt: Date.now() + ttl,
      lastAccess: Date.now(),
    });
  }

  /** 同时查内存和 MMKV */
  get<T>(key: string, persist = false): T | undefined {
    const m = this.getMem<T>(key);
    if (m !== undefined) return m;
    if (!persist) return undefined;

    const persisted = storage.getJSON<Entry<T>>(`cache:${key}`);
    if (!persisted) return undefined;
    if (persisted.expireAt < Date.now()) {
      storage.delete(`cache:${key}`);
      return undefined;
    }
    // 回填内存
    this.mem.set(key, { ...persisted, lastAccess: Date.now() });
    return persisted.value;
  }

  /** 设置缓存。persist=true 同步写入 MMKV */
  set<T>(key: string, value: T, ttl: number, persist = false) {
    this.setMem(key, value, ttl);
    if (persist) {
      storage.setJSON(`cache:${key}`, {
        value,
        expireAt: Date.now() + ttl,
        lastAccess: Date.now(),
      });
    }
  }

  delete(key: string) {
    this.mem.delete(key);
    storage.delete(`cache:${key}`);
  }

  /** 删除所有以 prefix 开头的 key */
  deletePrefix(prefix: string) {
    for (const k of Array.from(this.mem.keys())) {
      if (k.startsWith(prefix)) this.mem.delete(k);
    }
    storage.deletePrefix(`cache:${prefix}`);
  }

  /**
   * getOrSet 一站式：缓存命中则返回，否则调用 fetcher 并写入
   */
  async getOrSet<T>(
    key: string,
    ttl: number,
    fetcher: () => Promise<T>,
    persist = false
  ): Promise<T> {
    const hit = this.get<T>(key, persist);
    if (hit !== undefined) return hit;

    const value = await fetcher();
    this.set(key, value, ttl, persist);
    return value;
  }
}

export const cache = new TTLCache();
