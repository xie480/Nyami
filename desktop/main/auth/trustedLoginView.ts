import {
  BrowserWindow,
  Session,
  WebContentsView,
  session,
} from 'electron';
import {BILIBILI_LOGIN_COOKIE_NAMES, BILIBILI_REFERER} from '../constants';
import {
  hasRequiredLoginCookies,
  isTrustedBiliUrl,
} from '../security/urlPolicy';

type CookieReader = (cookie: string) => Promise<void>;

/**
 * 受控 Bilibili 登录页面适配器。
 * 页面只允许 B 站白名单导航，Cookie 由主进程 Session API 读取后立即交给安全存储。
 */
export class TrustedLoginViewController {
  private readonly loginSession: Session;

  private view: WebContentsView | null = null;

  private captureTimer: NodeJS.Timeout | null = null;

  private capturing = false;

  private readonly resizeHandler = (): void => {
    this.resize();
  };

  /**
   * 创建受控登录视图控制器。
   * @param window 承载 WebContentsView 的桌面窗口
   * @param onCookie 捕获到完整登录 Cookie 后的主进程回调
   */
  constructor(
    private readonly window: BrowserWindow,
    private readonly onCookie: CookieReader,
  ) {
    this.loginSession = session.fromPartition('persist:nyami-bilibili-login');
  }

  /**
   * 打开二维码回调地址，并安装导航与 Cookie 监听。
   * @param ticketUrl B 站二维码确认后的 ticket 地址
   */
  async open(ticketUrl: string): Promise<void> {
    if (!isTrustedBiliUrl(ticketUrl)) {
      throw new Error('B 站登录回调地址不在可信域名白名单中');
    }

    this.disposeView();
    this.capturing = false;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:nyami-bilibili-login',
      },
    });
    this.view = view;
    this.window.contentView.addChildView(view);
    this.window.on('resize', this.resizeHandler);
    this.resize();

    view.webContents.setWindowOpenHandler(({url}) => {
      if (isTrustedBiliUrl(url)) {
        void view.webContents.loadURL(url, {
          extraHeaders: `Referer: ${BILIBILI_REFERER}\n`,
        });
      }
      return {action: 'deny'};
    });

    view.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedBiliUrl(url)) {
        event.preventDefault();
      }
    });
    view.webContents.on('will-redirect', (event, url) => {
      if (!isTrustedBiliUrl(url)) {
        event.preventDefault();
      }
    });
    view.webContents.on('did-stop-loading', () => {
      void this.captureLoginCookies();
    });

    await view.webContents.loadURL(ticketUrl, {
      extraHeaders: `Referer: ${BILIBILI_REFERER}\n`,
    });
    if (this.view === view) {
      this.captureTimer = setInterval(() => {
        void this.captureLoginCookies();
      }, 500);
    }
  }

  /**
   * 清除受控登录 Session 中的 B 站 Cookie。
   */
  async clearSessionCookies(): Promise<void> {
    const cookies = await this.loginSession.cookies.get({});
    await Promise.all(
      cookies
        .filter(cookie => cookie.domain?.endsWith('bilibili.com'))
        .map(cookie =>
          this.loginSession.cookies.remove(
            `https://${cookie.domain?.replace(/^\./, '')}${cookie.path}`,
            cookie.name,
          ),
        ),
    );
  }

  /**
   * 清理 WebContentsView、计时器和窗口事件。
   */
  dispose(): void {
    this.disposeView();
  }

  /**
   * 更新 WebContentsView 尺寸，使其作为当前窗口内的受控登录面板。
   */
  private resize(): void {
    if (!this.view || this.window.isDestroyed()) {
      return;
    }

    const bounds = this.window.getContentBounds();
    this.view.setBounds({
      x: 24,
      y: 72,
      width: Math.max(320, bounds.width - 48),
      height: Math.max(240, bounds.height - 96),
    });
  }

  /**
   * 从持久化 Session 读取登录 Cookie，并在满足最小条件时交给上层保存。
   */
  private async captureLoginCookies(): Promise<void> {
    if (!this.view || this.capturing) {
      return;
    }

    const cookies = await this.loginSession.cookies.get({});
    const loginCookies = cookies.filter(
      cookie =>
        cookie.domain?.endsWith('bilibili.com') &&
        BILIBILI_LOGIN_COOKIE_NAMES.has(cookie.name),
    );
    const cookieHeader = loginCookies
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
    if (!hasRequiredLoginCookies(cookieHeader)) {
      return;
    }

    this.capturing = true;
    try {
      await this.onCookie(cookieHeader);
      this.disposeView();
    } finally {
      this.capturing = false;
    }
  }

  /**
   * 删除当前 WebContentsView。
   */
  private disposeView(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    this.window.removeListener('resize', this.resizeHandler);
    if (this.view) {
      this.window.contentView.removeChildView(this.view);
      this.view.webContents.close();
      this.view = null;
    }
  }
}
