import {BrowserWindow} from 'electron';
import QRCode from 'qrcode';
import {
  BILIBILI_QR_LIFETIME_MS,
  BILIBILI_QR_POLL_INTERVAL_MS,
} from '../constants';
import {
  IPC_CHANNELS,
  type AuthStatus,
  type QrSessionStartResult,
  type QrStatusEvent,
} from '../../shared/types';
import {CredentialStore} from './credentialStore';
import {QrClient} from './qrClient';
import {TrustedLoginViewController} from './trustedLoginView';

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

  private readonly credentialStore = new CredentialStore();

  private readonly trustedLoginView: TrustedLoginViewController;

  private session: QrSession | null = null;

  /**
   * 创建二维码登录控制器并绑定当前桌面窗口。
   * @param window 用于发送脱敏认证事件的桌面窗口
   */
  constructor(private readonly window: BrowserWindow) {
    this.trustedLoginView = new TrustedLoginViewController(
      window,
      async cookie => {
        await this.credentialStore.save(cookie, null);
        this.emit({
          status: 'success',
          message: '登录成功，Cookie 已安全保存',
          auth: await this.credentialStore.getStatus(),
        });
        this.stopSession();
      },
    );
  }

  /**
   * 生成二维码，并在主进程中开始轮询。
   * @returns Renderer 需要展示的二维码地址和过期时间
   */
  async start(): Promise<QrSessionStartResult> {
    this.stopSession();
    const qr = await this.client.generate();
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
      qrImageDataUrl: await QRCode.toDataURL(qr.url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 480,
      }),
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
    this.stopSession();
    await this.trustedLoginView.clearSessionCookies();
    await this.credentialStore.clear();
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
      this.emit({
        status: description.status,
        message: result.message || description.message,
        expiresAt: current.expiresAt,
      });

      if (description.status === 'success' && result.url) {
        this.stopSession();
        await this.trustedLoginView.open(result.url);
        return;
      }
      if (description.status === 'expired') {
        this.stopSession();
        return;
      }
    } catch (error) {
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
}
