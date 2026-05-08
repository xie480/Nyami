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
  /** 是否正在执行增量刷新（单收藏夹） */
  isRefreshing: boolean;
  
  initFolder: (folderId: number) => void;
  loadMore: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSortOption: (option: SortOption) => void;
  getDisplayedList: () => FavoriteVideo[];
  /**
   * 增量刷新当前收藏夹。
   * 调用 favorService.syncSingleFolder 获取新增视频，然后将其
   * 无损追加到 list 头部（新视频收藏时间最新，自然排最前），
   * 避免全量替换 list 导致的视图闪烁和列表滚动位置丢失。
   * 刷新完成后返回新增视频数量，调用方可据此决定是否给出用户反馈。
   */
  refreshFolder: (mediaId: number) => Promise<number>;
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
  isRefreshing: false,

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

  /**
   * 增量刷新：拉取新增视频 → 追加到 list 头部 → 更新全局索引
   *
   * === 无损追加策略 ===
   * 新增视频来源于 B 站 API（order=mtime 倒序），即最新收藏的排最前。
   * 因此直接将 newVideos 拼接到 list 头部即可维持时间倒序语义，
   * 无需全量重新从全局索引过滤，避免列表滚动位置回顶和白屏闪烁。
   */
  refreshFolder: async (mediaId: number): Promise<number> => {
    const state = get();
    // 防止刷新期间再次触发
    if (state.isRefreshing) return 0;
    // 防止刷新的收藏夹与当前视图不对应
    if (state.folderId !== mediaId) return 0;

    set({ isRefreshing: true, error: null });
    try {
      const newVideos = await favoriteService.syncSingleFolder(mediaId);
      if (newVideos.length > 0) {
        // 将新增视频追加到 list 头部（新视频 = 最新收藏，排在前面）
        set(prev => ({
          list: [...newVideos, ...prev.list],
        }));
      }
      return newVideos.length;
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    } finally {
      set({ isRefreshing: false });
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
