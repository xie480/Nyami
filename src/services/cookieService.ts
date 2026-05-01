import { storage } from '../core/storage';
import { cache } from '../core/cache';

const KEY = 'biliCookie';

export const cookieService = {
  /** 设置 Cookie，例如 "SESSDATA=xxxx;DedeUserID=12345" */
  set(cookie: string) {
    const trimmed = cookie.trim();
    if (!this.extractSessdata(trimmed)) {
      throw new Error('无效的 Cookie 格式，必须包含 SESSDATA');
    }
    storage.setString(KEY, trimmed);
    // 切换账号时清空相关缓存
    cache.deletePrefix('folders:');
    cache.deletePrefix('videos:');
    cache.deletePrefix('audioInfo:');
    storage.delete('wbiKeys'); // WBI 也需重新获取
  },

  get(): string {
    return storage.getString(KEY) || '';
  },

  clear() {
    storage.delete(KEY);
    cache.deletePrefix('folders:');
    cache.deletePrefix('videos:');
    cache.deletePrefix('audioInfo:');
  },

  /** 简单校验：从 Cookie 字符串里取 SESSDATA */
  extractSessdata(cookie: string): string | null {
    const m = cookie.match(/SESSDATA=([^;]+)/);
    return m ? m[1] : null;
  },

  /** 是否已登录 */
  isLoggedIn(): boolean {
    return !!this.extractSessdata(this.get());
  },
};
