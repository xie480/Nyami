import {app, safeStorage} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {extractBiliUid, hasRequiredLoginCookies} from '../security/urlPolicy';
import type {AuthStatus} from '../../shared/types';
import type {CredentialSnapshot} from '../../../packages/platform-contracts/src';

type StoredCredentials = {
  version: 1;
  cookie: string;
  refreshToken: string | null;
};

/**
 * Windows 凭证存储适配器。
 * Cookie 只在主进程内解密，Renderer 只能读取登录状态和 UID。
 */
export class CredentialStore {
  private readonly fileName = 'credentials.enc';

  /**
   * 返回加密凭证文件路径。
   * @returns 当前应用 userData 目录下的凭证路径
   */
  private getFilePath(): string {
    return path.join(app.getPath('userData'), this.fileName);
  }

  /**
   * 使用 Electron safeStorage 加密并保存 Cookie。
   * @param cookie B 站登录 Cookie
   * @param refreshToken 预留的轮换凭证，不向 Renderer 暴露
   */
  async save(cookie: string, refreshToken: string | null): Promise<void> {
    const normalizedCookie = cookie.trim();
    if (!hasRequiredLoginCookies(normalizedCookie)) {
      throw new Error('登录 Cookie 缺少 SESSDATA、DedeUserID 或 bili_jct');
    }

    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Windows 安全存储尚未可用');
    }

    const payload: StoredCredentials = {
      version: 1,
      cookie: normalizedCookie,
      refreshToken: refreshToken?.trim() || null,
    };
    const encrypted = await safeStorage.encryptStringAsync(
      JSON.stringify(payload),
    );

    await fs.mkdir(path.dirname(this.getFilePath()), {recursive: true});
    await fs.writeFile(this.getFilePath(), encrypted.toString('base64'), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  /** 读取共享核心所需的凭证快照；完整 Cookie 只在主进程内部使用。 */
  async getCredentials(): Promise<CredentialSnapshot> {
    const stored = await this.readInternal();
    return {
      cookie: stored?.cookie ?? '',
      refreshToken: stored?.refreshToken ?? null,
    };
  }

  /** 保存共享核心传入的凭证快照。 */
  async saveCredentials(
    cookie: string,
    refreshToken: string | null,
  ): Promise<void> {
    await this.save(cookie, refreshToken);
  }

  /** 清理共享核心使用的凭证。 */
  async clearCredentials(): Promise<void> {
    await this.clear();
  }

  /**
   * 读取并解密 Cookie，仅供主进程内部调用。
   * @returns 完整凭证；文件不存在或解密失败时返回 null
   */
  async readInternal(): Promise<StoredCredentials | null> {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        return null;
      }

      const encoded = await fs.readFile(this.getFilePath(), 'utf8');
      const encrypted = Buffer.from(encoded, 'base64');
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const plain = decrypted.result;
      const parsed = JSON.parse(plain) as Partial<StoredCredentials>;
      if (
        parsed.version !== 1 ||
        typeof parsed.cookie !== 'string' ||
        !hasRequiredLoginCookies(parsed.cookie)
      ) {
        return null;
      }

      return {
        version: 1,
        cookie: parsed.cookie,
        refreshToken:
          typeof parsed.refreshToken === 'string'
            ? parsed.refreshToken
            : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * 返回脱敏登录状态，不返回 Cookie、refresh token 或文件内容。
   * @returns Renderer 可见的登录状态
   */
  async getStatus(): Promise<AuthStatus> {
    const stored = await this.readInternal();
    const uid = stored ? extractBiliUid(stored.cookie) : null;
    return {
      loggedIn: Boolean(stored),
      uid,
      refreshAvailable: Boolean(stored?.refreshToken),
    };
  }

  /**
   * 清除本地登录凭证。
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.getFilePath());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
