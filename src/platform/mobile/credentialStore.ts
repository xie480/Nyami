import type {CredentialStore} from '../../../packages/platform-contracts/src';
import {cookieService} from '../../services/cookieService';

/** 将现有移动端 Keychain CookieService 适配为共享凭证契约。 */
export const mobileCredentialStore: CredentialStore = {
  /** 读取 Cookie 与 refresh token。 */
  async getCredentials() {
    return cookieService.getCredentials();
  },

  /** 保存 Cookie 与 refresh token。 */
  async saveCredentials(cookie: string, refreshToken: string | null) {
    await cookieService.setCredentials(cookie, refreshToken);
  },

  /** 清理登录凭证。 */
  async clearCredentials() {
    await cookieService.clear();
  },
};
