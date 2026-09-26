import {create} from 'zustand';
import {cookieService} from '../services';
import {biliApi} from '../services/biliApi';
import LoggerService from '../services/LoggerService';
import {biliLoginService} from '../services/biliLoginService';
import {biliWebViewBridge} from '../services/biliWebViewBridge';
import {AuthRequiredError} from '../core/errors';

type UserInfo = {
  uid: string;
  name: string;
  avatar: string;
};

/** B 站大会员等级 */
export type VipStatus = {
  /** 会员类型: 0=无, 1=月度, 2=年度 */
  type: number;
  /** 会员状态: 0=无, 1=有效 */
  status: number;
  /** 大会员到期时间（时间戳，秒） */
  dueDate?: number;
};

/** Auth store to manage login state and coordinate login flow */
type AuthState = {
  /** 是否已登录 */
  loggedIn: boolean;
  /** 当前用户 UID */
  userId: string | null;
  /** 当前用户信息 */
  userInfo: UserInfo | null;
  /** 大会员状态（null 表示未登录或尚未获取） */
  vipStatus: VipStatus | null;
  /** 是否为有效大会员（快捷访问） */
  isVip: boolean;
  /** 认证状态是否已初始化完成 */
  authReady: boolean;
  /** 登录成功后调用，设置状态并可传入 UID */
  login: (uid?: string) => Promise<boolean>;
  /** 登出，清除本地 Cookie 并重置状态 */
  logout: () => Promise<void>;
  /** 用于在登录完成后继续挂起的请求 */
  setLoginResolver: (resolver: () => void) => void;
  /** 保存当前的 resolver，登录完成后调用 */
  loginResolver: (() => void) | null;
  /** 手动设置用户信息 */
  setUserInfo: (info: UserInfo) => void;
  /** 初始化认证状态，应用启动时调用 */
  initAuth: () => Promise<void>;
  /** 设置认证就绪状态 */
  setAuthReady: (ready: boolean) => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  loggedIn: false,
  userId: null,
  userInfo: null,
  vipStatus: null,
  isVip: false,
  authReady: false,
  initAuth: async () => {
    try {
      const credentials = await cookieService.getCredentials();
      if (!credentials.cookie) {
        set({
          loggedIn: false,
          userId: null,
          userInfo: null,
          vipStatus: null,
          isVip: false,
        });
        return;
      }

      if (credentials.refreshToken) {
        try {
          const refreshInfo = await biliLoginService.getCookieRefreshInfo(
            credentials.cookie,
          );
          if (refreshInfo.refresh) {
            const refreshed = await biliWebViewBridge.refreshCookie(
              credentials.cookie,
              credentials.refreshToken,
              refreshInfo.timestamp,
            );
            await cookieService.setCredentials(
              refreshed.cookie,
              refreshed.refreshToken,
            );
          }
        } catch (error) {
          // 续期网络失败时继续校验现有 Cookie；绝不因临时失败清除 Keychain。
          LoggerService.warn(
            'authStore',
            'initAuth',
            error instanceof AuthRequiredError
              ? 'B 站会话需要重新登录'
              : 'B 站会话续期未完成',
          );
        }
      }

      const info = await biliApi.getUserInfo(true);
      const isVip = info.vipStatus.status === 1 && info.vipStatus.type > 0;
      set({
        loggedIn: true,
        userId: info.uid || null,
        userInfo: {uid: info.uid, name: info.name, avatar: info.avatar},
        vipStatus: info.vipStatus,
        isVip,
      });
    } catch (error) {
      LoggerService.warn(
        'authStore',
        'initAuth',
        error instanceof AuthRequiredError
          ? '已保存的 B 站会话失效'
          : '恢复 B 站登录状态失败',
      );
      set({
        loggedIn: false,
        userId: null,
        userInfo: null,
        vipStatus: null,
        isVip: false,
      });
    } finally {
      set({authReady: true});
    }
  },
  setAuthReady: ready => set({authReady: ready}),
  login: async uid => {
    let loggedIn = false;
    try {
      const info = await biliApi.getUserInfo(true);
      const isVip = info.vipStatus.status === 1 && info.vipStatus.type > 0;
      set({
        loggedIn: true,
        userInfo: {uid: info.uid, name: info.name, avatar: info.avatar},
        userId: info.uid || uid || null,
        vipStatus: info.vipStatus,
        isVip,
      });
      loggedIn = true;
    } catch (e) {
      LoggerService.warn('authStore', 'login', 'B 站未确认当前登录凭证');
      set({
        loggedIn: false,
        userId: null,
        userInfo: null,
        vipStatus: null,
        isVip: false,
      });
    }
    const resolver = get().loginResolver;
    if (resolver) {
      resolver();
      set({loginResolver: null});
    }
    return loggedIn;
  },
  logout: async () => {
    await cookieService.clear();
    set({
      loggedIn: false,
      userId: null,
      userInfo: null,
      vipStatus: null,
      isVip: false,
    });
  },
  setLoginResolver: resolver => {
    set({loginResolver: resolver});
  },
  loginResolver: null,
  setUserInfo: info => set({userInfo: info}),
}));
