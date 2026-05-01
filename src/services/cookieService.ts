import { storage } from '../core/storage';
import { cache } from '../core/cache';

const KEY = 'biliCookie';

export const cookieService = {
  set(cookie: string) {
    storage.setString(KEY, cookie.trim());
    cache.deletePrefix('folders:');
    cache.deletePrefix('videos:');
    cache.deletePrefix('audioInfo:');
    storage.delete('wbiKeys');
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

  extractSessdata(cookie: string): string | null {
    const m = cookie.match(/SESSDATA=([^;]+)/);
    return m ? m[1] : null;
  },

  isLoggedIn(): boolean {
    return !!this.extractSessdata(this.get());
  },
};
