import * as Keychain from 'react-native-keychain';
import { cache } from '../core/cache';
import LoggerService from './LoggerService';

// Keychain service identifier for B 站鉴权 Cookie
const COOKIE_SERVICE = 'bili_auth_cookie';

/**
 * Cookie 管理服务（加密存储）
 * - 使用系统安全存储（iOS Keychain / Android Keystore）
 * - 仅保存完整的 Cookie 字符串（包含 SESSDATA、bili_jct、DedeUserID 等）
 * - 提供 async 接口以匹配 Keychain 的 Promise API
 */
export const cookieService = {
  /**
   * 保存 Cookie（完整字符串）
   * @param cookie 示例: "SESSDATA=xxxx;DedeUserID=12345;..."
   */
  async set(cookie: string) {
    const trimmed = cookie.trim();
    if (!this.extractSessdata(trimmed)) {
      throw new Error('无效的 Cookie 格式，必须包含 SESSDATA');
    }
    // 从 Cookie 中提取 UID 作为用户名保存（便于后续查询）
    const uid = this.extractUid(trimmed) ?? '';
    await Keychain.setGenericPassword(uid, trimmed, {
      service: COOKIE_SERVICE,
      // 【P0修复 - 后台切歌】将访问级别从 WHEN_UNLOCKED（锁屏不可用）
      // 改为 AFTER_FIRST_UNLOCK（设备启动首次解锁后后台可读）。
      // 原配置导致锁屏状态下 cookieService.get() 阻塞/抛出异常，
      // 进而使 lazyResolve 无法获取 Cookie → API 请求失败 → 死锁。
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    // 切换账号或登录后，需要清空业务缓存
    cache.deletePrefix('folders:');
    cache.deletePrefix('videos:');
    cache.deletePrefix('audioInfo:');
  },

  /** 读取已保存的 Cookie，若不存在返回空字符串 */
  async get(): Promise<string> {
    try {
      const credentials = await Keychain.getGenericPassword({ service: COOKIE_SERVICE });
      if (credentials) {
        return credentials.password;
      }
    } catch (e) {
      LoggerService.error('cookieService', 'get', '读取 Keychain Cookie 失败', e);
    }
    return '';
  },

  /** 删除已保存的 Cookie 并清理业务缓存 */
  async clear() {
    try {
      await Keychain.resetGenericPassword({ service: COOKIE_SERVICE });
    } catch (e) {
      LoggerService.error('cookieService', 'clear', '清除 Keychain Cookie 失败', e);
    }
    cache.deletePrefix('folders:');
    cache.deletePrefix('videos:');
    cache.deletePrefix('audioInfo:');
  },

  /** 简单校验：从 Cookie 字符串里取 SESSDATA */
  extractSessdata(cookie: string): string | null {
    const m = cookie.match(/SESSDATA=([^;]+)/);
    return m ? m[1] : null;
  },

  /** 从 Cookie 中提取 DedeUserID（即 UID），用于登录状态展示 */
  extractUid(cookie: string): string | null {
    const m = cookie.match(/DedeUserID=([0-9]+)/);
    return m ? m[1] : null;
  },

  /** 判断当前是否已登录（依据本地存储的 Cookie） */
  async isLoggedIn(): Promise<boolean> {
    const ck = await this.get();
    return !!this.extractSessdata(ck);
  },
};
