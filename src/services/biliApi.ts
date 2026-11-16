import {createBiliApi} from '../../packages/core/src/api/biliApi';
import type {
  BiliHttpPort,
  BiliHttpRequestOptions,
  CredentialStore,
} from '../../packages/platform-contracts/src';
import {biliGet, biliPost} from '../core/http';
import {encWbi, getWbiKeys} from '../core/wbi';
import {cookieService} from './cookieService';

/**
 * 移动端 Bilibili API 适配器。
 * 共享核心负责参数校验、WBI 业务规则和数据契约；这里仅连接现有 Axios、MMKV/Keychain 和登录状态。
 */

const mobileHttp: BiliHttpPort = {
  /** 将共享 HTTP 选项转换为移动端现有 biliGet 调用。 */
  get<T>(
    url: string,
    options: BiliHttpRequestOptions = {},
    retries?: number,
  ): Promise<T> {
    const requestOptions = options as Parameters<typeof biliGet>[1];
    if (retries === undefined) {
      return biliGet<T>(url, requestOptions);
    }
    return biliGet<T>(url, requestOptions, retries);
  },

  /** 将共享 HTTP 选项转换为移动端现有 biliPost 调用。 */
  post<T>(
    url: string,
    body: string,
    options: BiliHttpRequestOptions = {},
  ): Promise<T> {
    return biliPost<T>(
      url,
      body,
      options as Parameters<typeof biliPost>[2],
    );
  },
};

const mobileCredentials: CredentialStore = {
  /** 读取现有 Keychain 凭证，隐藏移动端存储细节。 */
  async getCredentials() {
    const service = cookieService as typeof cookieService & {
      getCredentials?: () => Promise<{
        cookie: string;
        refreshToken: string | null;
      }>;
    };
    if (service.getCredentials) {
      return service.getCredentials();
    }
    return {
      cookie: await cookieService.get(),
      refreshToken: null,
    };
  },

  /** 保存共享核心产生的登录凭证。 */
  async saveCredentials(cookie: string, refreshToken: string | null) {
    await cookieService.setCredentials(cookie, refreshToken);
  },

  /** 清理移动端凭证。 */
  async clearCredentials() {
    await cookieService.clear();
  },
};

const mobileWbi = {
  /** 复用移动端现有 WBI 密钥缓存。 */
  getKeys: getWbiKeys,

  /** 使用共享纯函数生成签名，但保留现有测试和缓存入口。 */
  async sign(params: Record<string, unknown>) {
    const keys = await getWbiKeys();
    return encWbi(params, keys.imgKey, keys.subKey);
  },
};

/** 保持原有 `biliApi` 导出形态，供移动端页面和测试无感迁移。 */
export const biliApi = createBiliApi({
  http: mobileHttp,
  wbi: mobileWbi,
  credentials: mobileCredentials,
  /** 兼容移动端 CookieService 的账号校验和现有测试替身。 */
  async validateWriteCredentials(expectedUid: string) {
    if (!expectedUid) {
      throw new Error('当前账号未登录，无法修改 B 站收藏');
    }
    const cookie = await cookieService.get();
    if (
      !cookieService.extractSessdata(cookie) ||
      cookieService.extractUid(cookie) !== expectedUid
    ) {
      throw new Error('B 站登录账号已变化，请刷新页面后重试');
    }
    const csrf = cookieService.extractCsrf(cookie);
    if (!csrf) {
      throw new Error('登录 Cookie 缺少 bili_jct，请重新登录后重试');
    }
    return {cookie, csrf};
  },
});

export type {BiliApi} from '../../packages/core/src/api/biliApi';
