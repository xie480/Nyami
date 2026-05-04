// UI related store (e.g., global modal visibility)
import { create } from 'zustand';

interface UIState {
  /** 是否显示全局播放列表面板 */
  playlistVisible: boolean;
  /** 设置播放列表面板可见性 */
  setPlaylistVisible: (visible: boolean) => void;
  /** 是否显示登录弹窗 */
  loginModalVisible: boolean;
  /** 设置登录弹窗可见性 */
  setLoginModalVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  playlistVisible: false,
  setPlaylistVisible: (visible) => set({ playlistVisible: visible }),
  loginModalVisible: false,
  setLoginModalVisible: (visible) => set({ loginModalVisible: visible }),
}));
