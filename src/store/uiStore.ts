// UI related store (e.g., global modal visibility)
import {create} from 'zustand';

export type AuthRefreshTask = {
  id: string;
  cookie: string;
  refreshToken: string;
  timestamp: number;
};

interface UIState {
  /** 当前导航路由；供全局导航栏独立订阅，避免路由变化刷新 App 根树。 */
  currentRouteName: string | null;
  setCurrentRouteName: (routeName: string | null) => void;
  /** 是否显示全局播放列表面板 */
  playlistVisible: boolean;
  /** 设置播放列表面板可见性 */
  setPlaylistVisible: (visible: boolean) => void;
  /** 是否显示登录弹窗 */
  loginModalVisible: boolean;
  /** 设置登录弹窗可见性 */
  setLoginModalVisible: (visible: boolean) => void;
  /** Cookie 续期任务，由 LoginModal 中的第一方 WebView 执行 */
  authRefreshTask: AuthRefreshTask | null;
  setAuthRefreshTask: (task: AuthRefreshTask | null) => void;
  /** 玻璃主题背景过渡是否已完成（用于协调 ThemeProvider 延迟透明背景切换） */
  glassTransitionComplete: boolean;
  /** 设置玻璃主题背景过渡完成状态 */
  setGlassTransitionComplete: (complete: boolean) => void;
}

export const useUIStore = create<UIState>(set => ({
  currentRouteName: null,
  setCurrentRouteName: routeName =>
    set(state =>
      state.currentRouteName === routeName
        ? state
        : {currentRouteName: routeName},
    ),
  playlistVisible: false,
  setPlaylistVisible: visible => set({playlistVisible: visible}),
  loginModalVisible: false,
  setLoginModalVisible: visible => set({loginModalVisible: visible}),
  authRefreshTask: null,
  setAuthRefreshTask: task => set({authRefreshTask: task}),
  glassTransitionComplete: true,
  setGlassTransitionComplete: complete =>
    set({glassTransitionComplete: complete}),
}));
