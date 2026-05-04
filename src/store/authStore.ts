import { create } from 'zustand';
import { cookieService } from '../services';

/** Auth store to manage login state and coordinate login flow */
type AuthState = {
  /** 是否已登录 */
  loggedIn: boolean;
  /** 当前用户 UID */
  userId: string | null;
  /** 登录成功后调用，设置状态并可传入 UID */
  login: (uid?: string) => void;
  /** 登出，清除本地 Cookie 并重置状态 */
  logout: () => Promise<void>;
  /** 用于在登录完成后继续挂起的请求 */
  setLoginResolver: (resolver: () => void) => void;
  /** 保存当前的 resolver，登录完成后调用 */
  loginResolver: (() => void) | null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  loggedIn: false,
  userId: null,
  login: (uid) => {
    set({ loggedIn: true, userId: uid ?? null });
    // Resolve any pending request waiting for login
    const resolver = get().loginResolver;
    if (resolver) {
      resolver();
      set({ loginResolver: null });
    }
  },
  logout: async () => {
    await cookieService.clear();
    set({ loggedIn: false, userId: null });
  },
  setLoginResolver: (resolver) => {
    set({ loginResolver: resolver });
  },
  loginResolver: null
}));
