import { create } from 'zustand';
import { favoriteService } from '../services/favoriteService';
import { importedPlaylistService } from '../services/importedPlaylistService';
import type { FavoriteVideo, ImportedPlaylist } from '../types/domain';

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
  sourceKey: string | null;
  importedSource: ImportedPlaylist | null;
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
  initImportedSource: (source: ImportedPlaylist) => void;
  loadMore: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSortOption: (option: SortOption) => void;
  removeVideoFromCurrentFolder: (folderId: number, bvid: string) => void;
  getDisplayedList: () => FavoriteVideo[];
  /**
   * 增量刷新当前收藏夹，并将远端重叠页中的最新元数据与新增视频合并到 list。
   * 不替换整份列表，保留滚动位置；刷新完成后返回新增视频数量。
   */
  refreshFolder: (mediaId: number, signal?: AbortSignal) => Promise<number>;
  refreshImportedSource: (signal?: AbortSignal) => Promise<number>;
}

export const useFolderDataStore = create<FolderDataState>((set, get) => ({
  folderId: null,
  sourceKey: null,
  importedSource: null,
  list: [],
  page: 1,
  hasMore: true,
  loading: false,
  error: null,
  searchQuery: '',
  sortOption: SortOption.FavoriteTimeDesc,
  isRefreshing: false,

  initFolder: (folderId: number) => {
    const sourceKey = `ownedFavorite:${folderId}`;
    if (get().sourceKey === sourceKey) return;
    set({
      folderId,
      sourceKey,
      importedSource: null,
      list: [],
      page: 1,
      hasMore: true,
      loading: false,
      error: null,
      isRefreshing: false,
      searchQuery: '',
      sortOption: SortOption.FavoriteTimeDesc,
    });
    get().loadMore();
  },

  initImportedSource: (source: ImportedPlaylist) => {
    if (get().sourceKey === source.sourceKey) return;
    set({
      folderId: null,
      sourceKey: source.sourceKey,
      importedSource: source,
      list: [],
      page: 1,
      hasMore: true,
      loading: false,
      error: null,
      isRefreshing: false,
      searchQuery: '',
      sortOption: SortOption.FavoriteTimeDesc,
    });
    get().loadMore();
  },

  loadMore: async () => {
    const state = get();
    if (state.loading || state.isRefreshing || !state.hasMore || (!state.folderId && !state.importedSource)) return;

    set({ loading: true, error: null });

    try {
      if (state.importedSource) {
        const result = await importedPlaylistService.getVideos(
          state.importedSource,
          state.page,
        );
        set(prev => prev.sourceKey !== state.sourceKey
          ? prev
          : {
              list: [...prev.list, ...result.list],
              hasMore: result.hasMore,
              page: prev.page + 1,
              loading: false,
            });
        return;
      }

      // 优先从全局索引获取
      const folderId = state.folderId;
      if (folderId === null) {
        set(prev => prev.sourceKey !== state.sourceKey
          ? prev
          : {loading: false, error: '收藏夹来源已失效'});
        return;
      }
      const globalIndex = favoriteService.getGlobalIndex();
      if (globalIndex.length > 0) {
        const folderVideos = globalIndex.filter(v => v.folderIds?.includes(folderId));
        if (folderVideos.length > 0 && get().sourceKey === state.sourceKey) {
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
      const r = await favoriteService.getVideos(folderId, state.page);
      set(prev => prev.sourceKey !== state.sourceKey
        ? prev
        : {
            list: [...prev.list, ...r.list],
            hasMore: r.hasMore,
            page: prev.page + 1,
            loading: false,
          });
    } catch (e: any) {
      set(prev => prev.sourceKey !== state.sourceKey
        ? prev
        : { error: e.message, loading: false });
    }
  },

  /** 增量刷新远端首段，把最新元数据与新增条目合并进当前列表。 */
  refreshFolder: async (mediaId: number, signal?: AbortSignal): Promise<number> => {
    const state = get();
    // 防止刷新期间再次触发
    if (state.isRefreshing || state.loading) return 0;
    // 防止刷新的收藏夹与当前视图不对应
    if (state.folderId !== mediaId) return 0;

    set({ isRefreshing: true, error: null });
    try {
      const {newVideos, refreshedVideos} = await favoriteService.syncSingleFolder(mediaId, signal);
      if (signal?.aborted) return 0;
      if (refreshedVideos.length > 0) {
        const refreshedByBvid = new Map(refreshedVideos.map(video => [video.bvid, video]));
        set(prev => {
          if (prev.sourceKey !== state.sourceKey || prev.folderId !== mediaId) return prev;
          const updatedList = prev.list.map(video => refreshedByBvid.get(video.bvid) ?? video);
          const knownBvids = new Set(updatedList.map(video => video.bvid));
          const newItems = newVideos.filter(video => !knownBvids.has(video.bvid));
          return {list: [...newItems, ...updatedList]};
        });
      }
      return newVideos.length;
    } catch (e: any) {
      set(prev => prev.sourceKey === state.sourceKey ? {error: e.message} : prev);
      throw e;
    } finally {
      set(prev => prev.sourceKey === state.sourceKey ? {isRefreshing: false} : prev);
    }
  },

  refreshImportedSource: async (signal?: AbortSignal): Promise<number> => {
    const state = get();
    const source = state.importedSource;
    if (!source || state.isRefreshing || state.loading) return 0;

    set({ isRefreshing: true, error: null });
    try {
      importedPlaylistService.invalidateVideos(source.sourceKey);
      const loadedPageCount = Math.max(1, state.page - 1);
      const refreshedVideos: FavoriteVideo[] = [];
      let hasMore = true;
      let fetchedPage = 0;
      for (let page = 1; page <= loadedPageCount && hasMore; page += 1) {
        const result = await importedPlaylistService.getVideos(source, page, true, signal);
        if (signal?.aborted) return 0;
        refreshedVideos.push(...result.list);
        hasMore = result.hasMore;
        fetchedPage = page;
      }
      const deduplicatedVideos = Array.from(
        new Map(refreshedVideos.map(video => [video.bvid, video])).values(),
      );
      const previousBvids = new Set(state.list.map(video => video.bvid));
      const newCount = deduplicatedVideos.filter(video => !previousBvids.has(video.bvid)).length;
      set(current => {
        if (current.sourceKey !== source.sourceKey) return current;
        return {
          list: deduplicatedVideos,
          page: fetchedPage + 1,
          hasMore,
          loading: false,
          isRefreshing: false,
        };
      });
      return newCount;
    } catch (e: any) {
      set(current => current.sourceKey === source.sourceKey
        ? {error: e.message}
        : current);
      throw e;
    } finally {
      set(current => current.sourceKey === source.sourceKey
        ? {isRefreshing: false}
        : current);
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSortOption: (option: SortOption) => set({ sortOption: option }),
  removeVideoFromCurrentFolder: (folderId, bvid) => set(state =>
    state.folderId === folderId
      ? {list: state.list.filter(video => video.bvid !== bvid)}
      : state,
  ),

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
