import {BrowserWindow} from 'electron';
import QRCode from 'qrcode';
import {
  BILIBILI_AUTH_ENDPOINTS,
  BILIBILI_LOGIN_COOKIE_NAMES,
  BILIBILI_REFRESH_TOKEN_PATTERN,
  BILIBILI_QR_LIFETIME_MS,
  BILIBILI_QR_POLL_INTERVAL_MS,
} from '../constants';
import {
  IPC_CHANNELS,
  type AuthStatus,
  type AuthWebViewState,
  type QrSessionStartResult,
  type QrStatusEvent,
  type UserProfile,
} from '../../shared/types';
import {CookieRefreshService} from './cookieRefresh';
import {CredentialStore} from './credentialStore';
import {QrClient} from './qrClient';
import {TrustedLoginViewController} from './trustedLoginView';
import {
  hasRequiredLoginCookies,
  isTrustedBiliUrl,
} from '../security/urlPolicy';

type QrSession = {
  key: string;
  expiresAt: number;
  timer: NodeJS.Timeout | null;
  polling: boolean;
};

/**
 * 主进程二维码登录控制器。
 * 保存轮询密钥、打开受控 WebContentsView，并向 Renderer 发送脱敏状态事件。
 */
export class QrLoginController {
  private readonly client = new QrClient();

  private readonly cookieRefreshService = new CookieRefreshService();

  private readonly trustedLoginView: TrustedLoginViewController;

  private session: QrSession | null = null;

  private pendingRefreshToken: string | null = null;

  /**
   * 创建二维码登录控制器并绑定当前桌面窗口。
   * @param window 用于发送脱敏认证事件的桌面窗口
   * @param getProfile 登录凭证保存后读取当前账号资料，用于确认会话真实可用
   */
  constructor(
    private readonly window: BrowserWindow,
    private readonly credentialStore: CredentialStore = new CredentialStore(),
    private readonly onWebViewState?: (event: AuthWebViewState) => void,
    private readonly onAccountChanged?: (
      previousUid: string | null,
      nextUid: string | null,
    ) => Promise<void> | void,
    private readonly getProfile?: () => Promise<UserProfile | null>,
  ) {
    this.trustedLoginView = new TrustedLoginViewController(
      window,
      (cookie, refreshToken) => this.completeLogin(cookie, refreshToken),
    );
  }

  /**
   * 生成二维码，并在主进程中开始轮询。
   * @returns Renderer 需要展示的二维码地址和过期时间
   */
  async start(): Promise<QrSessionStartResult> {
    this.stopSession();
    this.closeWebLogin();
    const qr = await this.client.generate();
    const qrImageDataUrl = await QRCode.toDataURL(qr.url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 480,
    });
    const expiresAt = Date.now() + BILIBILI_QR_LIFETIME_MS;
    this.session = {
      key: qr.qrcode_key,
      expiresAt,
      timer: null,
      polling: false,
    };
    this.emit({
      status: 'waiting',
      message: '请使用 Bilibili 客户端扫码',
      expiresAt,
    });
    this.schedulePoll();
    return {
      qrImageDataUrl,
      expiresAt,
    };
  }

  /**
   * 停止当前二维码轮询，避免旧会话覆盖新登录状态。
   */
  stopSession(): void {
    if (this.session?.timer) {
      clearTimeout(this.session.timer);
    }
    this.session = null;
    this.pendingRefreshToken = null;
  }

  /**
   * 读取当前安全登录状态。
   * @returns 只包含 UID 和登录布尔值
   */
  async getStatus(): Promise<AuthStatus> {
    return this.credentialStore.getStatus();
  }

  /**
   * 清除登录凭证和二维码会话。
   */
  async logout(): Promise<void> {
    const previousUid = (await this.credentialStore.getStatus()).uid;
    this.stopSession();
    this.closeWebLogin();
    await this.trustedLoginView.clearSessionCookies();
    await this.credentialStore.clear();
    await this.onAccountChanged?.(previousUid, null);
    this.emit({
      status: 'idle',
      message: '已退出登录',
      auth: {loggedIn: false, uid: null},
    });
  }

  /**
   * 销毁控制器持有的 WebContentsView 和定时器。
   */
  dispose(): void {
    this.stopSession();
    this.trustedLoginView.dispose();
    this.emitWebViewState({open: false, mode: null});
  }

  /** 打开受控网页登录页面，支持二维码回调后未完成的账号登录。 */
  async openWebLogin(): Promise<void> {
    this.stopSession();
    this.emitWebViewState({open: true, mode: 'login'});
    try {
      await this.trustedLoginView.open(BILIBILI_AUTH_ENDPOINTS.passwordLogin);
    } catch (error) {
      this.closeWebLogin();
      throw error;
    }
  }

  /** 关闭当前受控网页登录页面。 */
  closeWebLogin(): void {
    this.trustedLoginView.dispose();
    this.pendingRefreshToken = null;
    this.emitWebViewState({open: false, mode: null});
  }

  /** 执行 Bilibili 官方 Cookie 续期流程并保存新的 refresh token。 */
  async renew(): Promise<AuthStatus> {
    const credentials = await this.credentialStore.getCredentials();
    if (!credentials.cookie || !credentials.refreshToken) {
      throw new Error('当前账号没有可用的续期凭证，请重新登录');
    }
    const refreshInfo = await this.cookieRefreshService.getRefreshInfo(
      credentials.cookie,
    );
    if (!refreshInfo.refresh) {
      return this.credentialStore.getStatus();
    }

    this.emitWebViewState({open: true, mode: 'refresh'});
    try {
      await this.trustedLoginView.seedCookies(credentials.cookie);
      await this.trustedLoginView.open(
        BILIBILI_AUTH_ENDPOINTS.webHome,
        false,
      );
      const result = await this.trustedLoginView.executeJavaScript<{
        ok?: boolean;
        refreshToken?: string;
      }>(
        this.cookieRefreshService.buildScript(
          credentials.refreshToken,
          refreshInfo.timestamp,
        ),
      );
      if (
        !result?.ok ||
        typeof result.refreshToken !== 'string'
      ) {
        throw new Error('B 站登录续期未完成，请重新登录');
      }
      const cookie = await this.waitForCookieHeader();
      await this.credentialStore.saveCredentials(cookie, result.refreshToken);
      const status = await this.credentialStore.getStatus();
      const profile = await this.readProfile();
      this.emit({
        status: 'success',
        message: '登录状态已续期',
        auth: {...status, profile},
      });
      return {...status, profile};
    } finally {
      this.closeWebLogin();
    }
  }

  /**
   * 递归安排下一次二维码状态轮询。
   */
  private schedulePoll(): void {
    const current = this.session;
    if (!current) {
      return;
    }

    current.timer = setTimeout(() => {
      void this.pollOnce();
    }, BILIBILI_QR_POLL_INTERVAL_MS);
  }

  /**
   * 执行一次二维码状态轮询，并在成功时由主进程打开受控页面。
   */
  private async pollOnce(): Promise<void> {
    const current = this.session;
    if (!current || current.polling) {
      return;
    }
    if (Date.now() >= current.expiresAt) {
      this.emit({status: 'expired', message: '二维码已过期，请重新生成'});
      this.stopSession();
      return;
    }

    current.polling = true;
    try {
      const result = await this.client.poll(current.key);
      const description = this.client.describeStatus(result.code);
      if (description.status !== 'success') {
        this.emit({
          status: description.status,
          message: result.message || description.message,
          expiresAt: current.expiresAt,
        });
      }

      if (description.status === 'success') {
        this.stopSession();
        const refreshToken = normalizeRefreshToken(result.refresh_token);
        const cookieHeader =
          result.cookieHeader ||
          (isTrustedBiliUrl(result.url)
            ? extractLoginCookieHeaderFromUrl(result.url)
            : '');
        if (hasRequiredLoginCookies(cookieHeader)) {
          await this.completeLogin(cookieHeader, refreshToken);
          return;
        }
        if (!result.url) {
          throw new Error('B 站未返回可用的登录凭证，请重新扫码');
        }
        if (cookieHeader) {
          await this.trustedLoginView.seedCookies(cookieHeader);
        }
        this.pendingRefreshToken = refreshToken;
        this.emit({
          status: 'scanned',
          message: '扫码成功，正在完成登录',
          expiresAt: current.expiresAt,
        });
        this.emitWebViewState({open: true, mode: 'login'});
        await this.trustedLoginView.open(result.url);
        return;
      }
      if (description.status === 'expired') {
        this.stopSession();
        return;
      }
    } catch (error) {
      this.closeWebLogin();
      this.emit({
        status: 'error',
        message: error instanceof Error ? error.message : '二维码轮询失败',
      });
    } finally {
      if (this.session === current) {
        current.polling = false;
        this.schedulePoll();
      }
    }
  }

  /**
   * 将脱敏事件发送给当前 Renderer。
   * @param event 不包含 Cookie、refresh token 或二维码轮询密钥的事件
   */
  private emit(event: QrStatusEvent): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.auth.qrStatus, event);
    }
  }

  /** 保存登录 Cookie，并在二维码登录成功后保留 Bilibili 返回的续期凭证。 */
  private async completeLogin(
    cookie: string,
    refreshToken?: string | null,
  ): Promise<void> {
    const previous = await this.credentialStore.getCredentials();
    const nextRefreshToken =
      refreshToken ??
      this.pendingRefreshToken ??
      (extractUid(cookie) === extractUid(previous.cookie)
        ? previous.refreshToken
        : null);
    const previousUid = extractUid(previous.cookie);
    const nextUid = extractUid(cookie);
    if (!nextUid) {
      throw new Error('登录 Cookie 缺少有效账号 UID');
    }

    let credentialsSaved = false;
    try {
      await this.credentialStore.saveCredentials(cookie, nextRefreshToken);
      credentialsSaved = true;
      const profile = await this.validateProfile(nextUid);
      await this.onAccountChanged?.(previousUid, nextUid);
      this.pendingRefreshToken = null;
      const status = await this.credentialStore.getStatus();
      this.emit({
        status: 'success',
        message: '登录成功，账号资料已确认',
        auth: {...status, profile},
      });
      this.stopSession();
      this.closeWebLogin();
    } catch (error) {
      if (credentialsSaved) {
        await this.restoreCredentials(previous.cookie, previous.refreshToken);
      }
      throw error;
    }
  }

  /** 登录成功后验证当前 Cookie，并返回与 Cookie UID 匹配的公开资料。 */
  private async validateProfile(expectedUid: string): Promise<UserProfile | null> {
    if (!this.getProfile) {
      return null;
    }
    try {
      const profile = await this.getProfile();
      if (!profile || profile.uid !== expectedUid) {
        throw new Error('B 站没有确认当前会话，请重新扫码或检查账号验证');
      }
      return profile;
    } catch {
      throw new Error('B 站没有确认当前会话，请重新扫码或检查账号验证');
    }
  }

  /** 读取续期后的账号资料；资料接口暂时不可用时不阻断已保存的会话。 */
  private async readProfile(): Promise<UserProfile | null> {
    if (!this.getProfile) {
      return null;
    }
    try {
      return await this.getProfile();
    } catch {
      return null;
    }
  }

  /** 登录资料验证失败时恢复此前的凭证，避免留下未经确认的新账号。 */
  private async restoreCredentials(
    cookie: string,
    refreshToken: string | null,
  ): Promise<void> {
    if (hasRequiredLoginCookies(cookie)) {
      await this.credentialStore.saveCredentials(cookie, refreshToken);
      return;
    }
    await this.credentialStore.clearCredentials();
  }

  /** 等待受控 Session 写入新 Cookie，避免读取到续期前的旧值。 */
  private async waitForCookieHeader(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const cookie = await this.trustedLoginView.readCookieHeader();
      if (cookie.includes('SESSDATA=') && cookie.includes('bili_jct=')) {
        return cookie;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('续期后未读取到完整 Bilibili Cookie');
  }

  /** 向 Renderer 发送受控 WebContentsView 状态。 */
  private emitWebViewState(event: AuthWebViewState): void {
    this.onWebViewState?.(event);
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.auth.webViewState, event);
    }
  }
}

/** 只接受 B 站二维码接口返回的受限 refresh token。 */
function normalizeRefreshToken(value: string | undefined): string | null {
  return value && BILIBILI_REFRESH_TOKEN_PATTERN.test(value) ? value : null;
}

/** 兼容旧版二维码接口，把成功 URL 查询参数中的登录 Cookie 转成请求头。 */
function extractLoginCookieHeaderFromUrl(value: string): string {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    return Array.from(BILIBILI_LOGIN_COOKIE_NAMES)
      .map(name => {
        const cookie = url.searchParams.get(name);
        return cookie ? `${name}=${cookie}` : '';
      })
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

/** 从 Cookie 头中读取账号 UID。 */
function extractUid(cookie: string): string | null {
  return cookie.match(/(?:^|;\s*)DedeUserID=([0-9]+)/)?.[1] ?? null;
}
