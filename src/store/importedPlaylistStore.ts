import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { storage } from '../core/storage';
import type { ImportedPlaylist } from '../types/domain';

const mmkvStorage: StateStorage = {
  getItem: name => storage.getString(name) ?? null,
  setItem: (name, value) => storage.setString(name, value),
  removeItem: name => storage.delete(name),
};

interface ImportedPlaylistState {
  catalogByUid: Record<string, ImportedPlaylist[]>;
  visibleSourceKeysByUid: Record<string, string[]>;
  setCatalog: (uid: string, sources: ImportedPlaylist[]) => void;
  setVisibleSourceKeys: (uid: string, sourceKeys: string[]) => void;
}

/** 按 B 站 UID 隔离自动导入来源清单与用户的主页显示选择。 */
export const useImportedPlaylistStore = create<ImportedPlaylistState>()(
  persist(
    set => ({
      catalogByUid: {},
      visibleSourceKeysByUid: {},
      setCatalog: (uid, sources) =>
        set(state => ({
          catalogByUid: {...state.catalogByUid, [uid]: sources},
        })),
      setVisibleSourceKeys: (uid, sourceKeys) =>
        set(state => ({
          visibleSourceKeysByUid: {
            ...state.visibleSourceKeysByUid,
            [uid]: Array.from(new Set(sourceKeys)),
          },
        })),
    }),
    {
      name: 'importedPlaylistStore',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
