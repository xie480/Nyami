// Global selection store for folder multi-select
import { create } from 'zustand';
import type { FavoriteFolder } from '../types/domain';

interface SelectionState {
  /** Set of selected folder IDs */
  selectedIds: Set<number>;
  /** Toggle selection of a folder */
  toggle: (id: number) => void;
  /** Clear all selections */
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set(),
  toggle: (id: number) => {
    const newSet = new Set(get().selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    set({ selectedIds: newSet });
  },
  clear: () => set({ selectedIds: new Set() }),
}));
