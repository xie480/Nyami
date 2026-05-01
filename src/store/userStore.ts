import { create } from 'zustand';
import { storage } from '../core/storage';

interface UserState {
  uid: string;
  setUid: (uid: string) => void;
}

export const useUserStore = create<UserState>((set) => ({
  uid: storage.getString('uid') || '',
  setUid: (uid) => {
    storage.setString('uid', uid);
    set({ uid });
  },
}));
