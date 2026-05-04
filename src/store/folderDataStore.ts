import { create } from 'zustand';
import { favoriteService } from '../services/favoriteService';
import type { FavoriteVideo } from '../types/domain';

export enum SortOption {
  TitleAsc = 'title_asc',
  TitleDesc = 'title_desc',
  DurationAsc = 'duration_asc',
  DurationDesc = 'duration_desc',
  FavoriteTimeAsc = 'favtime_asc',
  FavoriteTimeDesc = 'favtime_desc',
}

interface FolderDataState {
  folderId: number | null;
  list: FavoriteVideo[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  sortOption: SortOption;
  
  initFolder: (folderId: number) => void;
  loadMore: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSortOption: (option: SortOption) => void;
  getDisplayedList: () => FavoriteVideo[];
}

export const useFolderDataStore = create<FolderDataState>((set, get) => ({
  folderId: null,
  list: [],
  page: 1,
  hasMore: true,
  loading: false,
  error: null,
  searchQuery: '',
  sortOption: SortOption.FavoriteTimeDesc,

  initFolder: (folderId: number) => {
    if (get().folderId === folderId) return;
    set({
      folderId,
      list: [],
      page: 1,
      hasMore: true,
      loading: false,
      error: null,
      searchQuery: '',
      sortOption: SortOption.FavoriteTimeDesc,
    });
    get().loadMore();
  },

  loadMore: async () => {
    const state = get();
    if (state.loading || !state.hasMore || !state.folderId) return;

    set({ loading: true, error: null });

    try {
      // 优先从全局索引获取
      const globalIndex = favoriteService.getGlobalIndex();
      if (globalIndex.length > 0) {
        const folderVideos = globalIndex.filter(v => v.folderIds?.includes(state.folderId!));
        if (folderVideos.length > 0) {
          if (state.page === 1) {
            set({
              list: folderVideos,
              hasMore: false,
              loading: false,
            });
            return;
          }
        }
      }

      // 如果全局索引没有或者需要分页请求远端
      const r = await favoriteService.getVideos(state.folderId, state.page);
      set(prev => ({
        list: [...prev.list, ...r.list],
        hasMore: r.hasMore,
        page: prev.page + 1,
        loading: false,
      }));
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSortOption: (option: SortOption) => set({ sortOption: option }),

  getDisplayedList: () => {
    const { list, searchQuery, sortOption } = get();
    const filteredList = list.filter(v => v.title.toLowerCase().includes(searchQuery.toLowerCase()));
    
    switch (sortOption) {
      case SortOption.TitleAsc:
        return [...filteredList].sort((a, b) => a.title.localeCompare(b.title));
      case SortOption.TitleDesc:
        return [...filteredList].sort((a, b) => b.title.localeCompare(a.title));
      case SortOption.DurationAsc:
        return [...filteredList].sort((a, b) => a.duration - b.duration);
      case SortOption.DurationDesc:
        return [...filteredList].sort((a, b) => b.duration - a.duration);
      case SortOption.FavoriteTimeAsc:
        return [...filteredList].reverse(); // 逆序得到时间正序
      case SortOption.FavoriteTimeDesc:
      default:
        return filteredList; // 原始顺序即收藏时间逆序
    }
  },
}));
