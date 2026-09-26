import {useUIStore, type AuthRefreshTask} from '../store/uiStore';

export type RefreshedCredentials = {
  cookie: string;
  refreshToken: string;
};

type PendingRefresh = {
  id: string;
  resolve: (value: RefreshedCredentials) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let pendingRefresh: PendingRefresh | null = null;

/** 让已挂载的第一方 WebView 完成 B 站要求的 Cookie 刷新及确认步骤。 */
export const biliWebViewBridge = {
  refreshCookie(cookie: string, refreshToken: string, timestamp: number) {
    if (pendingRefresh) {
      return Promise.reject(new Error('登录凭证正在续期'));
    }

    const id = `refresh-${Date.now()}`;
    return new Promise<RefreshedCredentials>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.finish(id, null, new Error('登录续期超时，请稍后重试'));
      }, 45000);
      pendingRefresh = {id, resolve, reject, timeout};
      const task: AuthRefreshTask = {id, cookie, refreshToken, timestamp};
      useUIStore.getState().setAuthRefreshTask(task);
    });
  },

  finish(id: string, value: RefreshedCredentials | null, error?: Error) {
    if (!pendingRefresh || pendingRefresh.id !== id) {
      return;
    }
    const pending = pendingRefresh;
    pendingRefresh = null;
    clearTimeout(pending.timeout);
    useUIStore.getState().setAuthRefreshTask(null);
    if (error || !value) {
      pending.reject(error ?? new Error('登录续期失败'));
      return;
    }
    pending.resolve(value);
  },
};
