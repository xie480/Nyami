/**
 * B 站本地凭证仓库。
 * 使用系统 Keychain/Keystore 保存版本化 Cookie 与刷新令牌，
 * 并在读取时兼容迁移旧版只含 Cookie 的记录。
 */
import * as Keychain from 'react-native-keychain';
import {cache} from '../core/cache';
import {
  BILIBILI_COOKIE_NAMES,
  BILIBILI_REFRESH_TOKEN_PATTERN,
} from '../config/bilibiliAuth';
import LoggerService from './LoggerService';

// Keychain service identifier for B 站鉴权 Cookie
const COOKIE_SERVICE = 'bili_auth_cookie';
const CREDENTIAL_VERSION = 2;

export type BiliCredentials = {
  cookie: string;
  refreshToken: string | null;
};

type StoredCredentials = BiliCredentials & {
  version: typeof CREDENTIAL_VERSION;
};

/**
 * Cookie 管理服务（加密存储）
 * - 使用系统安全存储（iOS Keychain / Android Keystore）
 * - Cookie 与 B 站轮换 refresh_token 作为同一份凭证保存
 * - 兼容迁移旧版只保存 Cookie 的 Keychain 数据
 * - 提供 async 接口以匹配 Keychain 的 Promise API
 */
export const cookieService = {
  /**
   * 保存 Cookie（完整字符串）
   * @param cookie 示例: "SESSDATA=xxxx;DedeUserID=12345;..."
   */
  async set(cookie: string) {
    const current = await this.getCredentials();
    const nextUid = this.extractUid(cookie.trim());
    const currentUid = this.extractUid(current.cookie);
    await this.setCredentials(
      cookie,
      nextUid && nextUid === currentUid ? current.refreshToken : null,
    );
  },

  /** 原子保存 Cookie 与轮换 refresh_token */
  async setCredentials(
    cookie: string,
    refreshToken: string | null,
    clearCachesOnAccountChange = true,
  ) {
    const trimmed = cookie.trim();
    if (!this.extractSessdata(trimmed)) {
      throw new Error('无效的 Cookie 格式，必须包含 SESSDATA');
    }
    const normalizedRefreshToken = refreshToken?.trim() || null;
    if (
      normalizedRefreshToken &&
      !BILIBILI_REFRESH_TOKEN_PATTERN.test(normalizedRefreshToken)
    ) {
      throw new Error('无效的 B 站续期凭证格式');
    }
    const uid = this.extractUid(trimmed) ?? '';
    const credentials: StoredCredentials = {
      version: CREDENTIAL_VERSION,
      cookie: trimmed,
      refreshToken: normalizedRefreshToken,
    };
    let existing: false | {password: string} = false;
    try {
      existing = await Keychain.getGenericPassword({service: COOKIE_SERVICE});
    } catch {
      // Prior credentials are only needed to determine whether account caches should be cleared.
    }
    const existingCredentials = existing
      ? this.parseCredentials(existing.password) ?? {
          cookie: existing.password,
          refreshToken: null,
        }
      : null;
    const previousUid = existingCredentials
      ? this.extractUid(existingCredentials.cookie)
      : null;
    await Keychain.setGenericPassword(uid, JSON.stringify(credentials), {
      service: COOKIE_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    if (clearCachesOnAccountChange && previousUid !== uid) {
      this.clearAccountCaches();
    }
  },

  clearAccountCaches() {
    cache.deletePrefix('folders:');
    cache.deletePrefix('videos:');
    cache.deletePrefix('audioInfo:');
  },

  /** 读取已保存的 Cookie，若不存在返回空字符串 */
  async get(): Promise<string> {
    return (await this.getCredentials()).cookie;
  },

  /** 读取版本化凭证，并将历史明文 Cookie 格式迁移为版本化结构 */
  async getCredentials(): Promise<BiliCredentials> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: COOKIE_SERVICE,
      });
      if (credentials) {
        const stored = this.parseCredentials(credentials.password);
        if (stored) {
          return stored;
        }

        // 老版本直接将 Cookie 字符串存为 password，保持兼容并迁移。
        if (this.extractSessdata(credentials.password)) {
          const legacy = {cookie: credentials.password, refreshToken: null};
          try {
            await this.persistCredentials(credentials.username, legacy);
          } catch {
            LoggerService.warn(
              'cookieService',
              'get',
              '旧版 Keychain 凭证迁移未完成，继续使用原凭证',
            );
          }
          return legacy;
        }
      }
    } catch (e) {
      LoggerService.error('cookieService', 'get', '读取 Keychain 凭证失败');
    }
    return {cookie: '', refreshToken: null};
  },

  async persistCredentials(uid: string, value: BiliCredentials) {
    const stored: StoredCredentials = {version: CREDENTIAL_VERSION, ...value};
    await Keychain.setGenericPassword(uid, JSON.stringify(stored), {
      service: COOKIE_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  parseCredentials(value: string): BiliCredentials | null {
    try {
      const parsed = JSON.parse(value) as Partial<StoredCredentials>;
      if (
        parsed.version === CREDENTIAL_VERSION &&
        typeof parsed.cookie === 'string' &&
        this.extractSessdata(parsed.cookie)
      ) {
        return {
          cookie: parsed.cookie,
          refreshToken:
            typeof parsed.refreshToken === 'string' &&
            BILIBILI_REFRESH_TOKEN_PATTERN.test(parsed.refreshToken)
              ? parsed.refreshToken
              : null,
        };
      }
    } catch {
      // 非 JSON 内容属于旧版原始 Cookie，由 getCredentials 迁移。
    }
    return null;
  },

  /** 删除已保存的 Cookie 并清理业务缓存 */
  async clear() {
    try {
      await Keychain.resetGenericPassword({service: COOKIE_SERVICE});
    } catch (e) {
      LoggerService.error(
        'cookieService',
        'clear',
        '清除 Keychain Cookie 失败',
        e,
      );
    }
    this.clearAccountCaches();
  },

  /** 简单校验：从 Cookie 字符串里取 SESSDATA */
  extractSessdata(cookie: string): string | null {
    const m = cookie.match(
      new RegExp(`(?:^|;\\s*)${BILIBILI_COOKIE_NAMES.sessdata}=([^;]+)`),
    );
    return m ? m[1] : null;
  },

  /** 从 Cookie 中提取 DedeUserID（即 UID），用于登录状态展示 */
  extractUid(cookie: string): string | null {
    const m = cookie.match(
      new RegExp(`(?:^|;\\s*)${BILIBILI_COOKIE_NAMES.uid}=([0-9]+)`),
    );
    return m ? m[1] : null;
  },

  /** 从 Cookie 中提取收藏写入所需的 CSRF Token。 */
  extractCsrf(cookie: string): string | null {
    const m = cookie.match(
      new RegExp(`(?:^|;\\s*)${BILIBILI_COOKIE_NAMES.csrf}=([^;]+)`),
    );
    return m ? m[1] : null;
  },

  /** 判断当前是否已登录（依据本地存储的 Cookie） */
  async isLoggedIn(): Promise<boolean> {
    const ck = await this.get();
    return !!this.extractSessdata(ck);
  },
};
