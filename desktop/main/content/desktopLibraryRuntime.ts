import {
  trimFavoriteVideo,
  type BiliCollectedPlaylist,
  type BiliSeasonArchive,
  type BiliApi,
  type FavoriteSyncProgress,
  type FavoriteSyncTarget,
  type FavoriteVideo,
} from '../../../packages/core/src';
import {FavoriteSyncTask} from '../../../packages/core/src/favorites/syncTask';
import type {CredentialStore} from '../auth/credentialStore';
import {DESKTOP_SYNC_PLAYLIST_CONCURRENCY} from '../constants';
import type {AppLogger} from '../logging/appLogger';
import {normalizeBiliAssetUrl} from '../security/urlPolicy';
import {DesktopLibraryRepository} from '../storage/desktopLibraryRepository';
import type {
  DesktopPage,
  DesktopVideo,
  FavoriteSourceKind,
  FavoriteSourceSummary,
  FavoriteSearchContentRequest,
} from '../../shared/types';
import {getFavoriteSourceKey} from '../../shared/libraryFilters';

const FAVORITE_PAGE_SIZE = 20;

type LibrarySyncOptions = {
  force?: boolean;
  signal?: AbortSignal;
  sourceKeys?: string[];
  onPhase?: (phase: 'catalog' | 'favorites', total: number) => void;
  onFavoriteProgress?: (progress: FavoriteSyncProgress) => void;
};

/**
 * 桌面端轻量收藏索引运行时。
 * 该类同步当前账号可访问的收藏来源，并把本地索引读取交给 SQLite。
 */
export class DesktopLibraryRuntime {
  private readonly pendingRequests = new Map<string, AbortController>();

  /**
   * 创建桌面收藏索引运行时。
   * @param api 已注入主进程凭证的共享 Bilibili API
   * @param credentials 主进程凭证存储，用于账号切换校验
   * @param repository SQLite 收藏仓储
   * @param logger 脱敏日志器
   */
  constructor(
    private readonly api: BiliApi,
    private readonly credentials: CredentialStore,
    private readonly repository: DesktopLibraryRepository,
    private readonly logger: AppLogger,
  ) {}

  /** 同步当前账号的收藏来源，建立轻量本地收藏索引。 */
  async synchronize(
    uid: string,
    options: LibrarySyncOptions = {},
  ): Promise<FavoriteSyncProgress> {
    await this.assertCurrentAccount(uid);
    this.repository.switchAccount(uid);
    options.onPhase?.('catalog', 0);
    const targets = await this.buildSyncTargets(
      uid,
      options.signal,
      options.sourceKeys,
    );
    options.onPhase?.('favorites', targets.length);
    const task = new FavoriteSyncTask(
      this.repository,
      DESKTOP_SYNC_PLAYLIST_CONCURRENCY,
    );
    return task.run(targets, {
      force: options.force,
      concurrency: DESKTOP_SYNC_PLAYLIST_CONCURRENCY,
      signal: options.signal,
      onProgress: options.onFavoriteProgress,
    });
  }

  /** 账号登录、切换或退出后清理不应继续展示的旧账号索引。 */
  handleAccountChanged(
    previousUid: string | null,
    nextUid: string | null,
  ): void {
    if (previousUid === nextUid) {
      return;
    }
    if (nextUid) {
      this.repository.switchAccount(nextUid);
      return;
    }
    this.repository.clearAccount(previousUid ?? undefined);
  }

  /** 读取当前账号去重后的全局收藏索引。 */
  async getGlobalIndex(uid: string): Promise<FavoriteVideo[]> {
    await this.assertCurrentAccount(uid);
    this.repository.switchAccount(uid);
    return this.repository.getGlobalIndex(uid);
  }

  /** 读取远端来源目录并合并本地同步状态。 */
  async getSourceSummaries(
    uid: string,
    sourceKeys?: readonly string[],
    requestId?: string,
  ): Promise<FavoriteSourceSummary[]> {
    return this.withRequest(
      requestId ?? `sources:${uid}`,
      async signal => {
        await this.assertCurrentAccount(uid);
        this.repository.switchAccount(uid);
        const localSources = new Map(
          this.repository.getSourceSummaries(uid).map(source => [
            source.sourceKey,
            source,
          ]),
        );
        const remoteSources = await this.buildSourceCatalog(
          uid,
          signal,
          localSources,
        );
        const requested = new Set(
          (sourceKeys ?? []).map(value => value.trim()).filter(Boolean),
        );
        return remoteSources
          .filter(source => !requested.size || requested.has(source.sourceKey))
          .map(source => ({
            ...source,
            syncStatus: localSources.get(source.sourceKey)?.syncStatus ?? 'idle',
            lastSyncedAt: localSources.get(source.sourceKey)?.lastSyncedAt ?? null,
          }));
      },
    );
  }

  /** 读取当前账号的全局去重索引，并按导入来源过滤。 */
  async getFavoriteIndex(
    uid: string,
    sourceKeys?: readonly string[],
    requestId?: string,
  ): Promise<DesktopVideo[]> {
    return this.withRequest(
      requestId ?? `favorite-index:${uid}`,
      async () => {
        await this.assertCurrentAccount(uid);
        this.repository.switchAccount(uid);
        const visible = new Set(
          (sourceKeys ?? []).map(value => value.trim()).filter(Boolean),
        );
        return (await this.repository.getGlobalIndex(uid))
          .map(video => toFavoriteDesktopVideo(video))
          .filter(video =>
            visible.size === 0 ||
            (video.sourceKeys ?? []).some(sourceKey => visible.has(sourceKey)),
          );
      },
    );
  }

  /** 读取单个来源的本地索引分页。 */
  async getSourceVideos(
    uid: string,
    sourceKey: string,
    page: number,
    requestId?: string,
  ): Promise<DesktopPage<DesktopVideo>> {
    return this.withRequest(
      requestId ?? `source-videos:${uid}:${sourceKey}:${page}`,
      async () => {
        await this.assertCurrentAccount(uid);
        this.repository.switchAccount(uid);
        const result = this.repository.getSourceVideos(
          uid,
          sourceKey,
          page,
          FAVORITE_PAGE_SIZE,
        );
        return {
          items: result.items.map(video => toFavoriteDesktopVideo(video)),
          page,
          hasMore: page * FAVORITE_PAGE_SIZE < result.total,
          total: result.total,
        };
      },
    );
  }

  /** 强制刷新指定来源并返回刷新后的同步状态。 */
  async refreshSources(
    uid: string,
    sourceKeys: readonly string[],
    requestId?: string,
  ): Promise<FavoriteSourceSummary[]> {
    return this.withRequest(
      requestId ?? `refresh-sources:${uid}`,
      async signal => {
        const normalizedKeys = Array.from(
          new Set(sourceKeys.map(value => value.trim()).filter(Boolean)),
        );
        if (!normalizedKeys.length) {
          return this.getSourceSummaries(uid);
        }
        await this.synchronize(uid, {
          force: true,
          signal,
          sourceKeys: normalizedKeys,
        });
        return this.getSourceSummaries(uid, normalizedKeys);
      },
    );
  }

  /** 判断账号是否已经成功建立过本地收藏索引。 */
  hasLocalIndex(uid: string): boolean {
    return this.repository.hasAccountData(uid);
  }

  /** 在本地收藏索引中按标题、UP 主或收藏夹名称搜索。 */
  async searchFavorites(
    request: FavoriteSearchContentRequest,
  ): Promise<DesktopPage<DesktopVideo>> {
    return this.withRequest(request.requestId, async () => {
      await this.assertCurrentAccount(request.uid);
      this.repository.switchAccount(request.uid);
      const result = this.repository.searchFavorites(
        request.uid,
        request.keyword,
        request.page,
        FAVORITE_PAGE_SIZE,
      );
      return {
        items: result.items.map(video => toFavoriteDesktopVideo(video)),
        page: request.page,
        hasMore: request.page * FAVORITE_PAGE_SIZE < result.total,
        total: result.total,
      };
    });
  }

  /** 取消 Renderer 不再需要的本地收藏搜索请求。 */
  cancel(requestId: string): void {
    this.pendingRequests.get(requestId)?.abort();
  }

  /** 清理当前账号的本地收藏索引。 */
  clearAccount(uid: string): void {
    this.repository.clearAccount(uid);
  }

  /** 读取并规范化当前账号自有收藏夹，转换为共享同步目标。 */
  private async buildSyncTargets(
    uid: string,
    signal?: AbortSignal,
    sourceKeys?: readonly string[],
  ): Promise<FavoriteSyncTarget[]> {
    const folderResponse = await this.api.getFavoriteFolders(
      uid,
      signal,
      undefined,
      'index',
    );
    const ownedTargets = (folderResponse.list ?? [])
      .filter(folder => folder.id > 0)
      .map(folder => ({
        playlistId: `ownedFavorite:${folder.id}`,
        title: folder.title,
        remoteVideoCount: Math.max(0, folder.media_count),
        kind: 'owned' as const,
        ownerMid: folder.mid,
        ownerName: '',
        cover: normalizeBiliAssetUrl(folder.cover ?? ''),
        fetchPage: async (page: number, pageSignal?: AbortSignal) => {
          const response = await this.api.getFavoriteVideos(
            folder.id,
            page,
            FAVORITE_PAGE_SIZE,
            pageSignal,
            'index',
          );
          const medias = response.medias ?? [];
          return {
            list: medias
              .filter(media => media.attr === 0)
              .map(trimFavoriteVideo),
            hasMore:
              response.has_more === true || medias.length === FAVORITE_PAGE_SIZE,
            rawCount: medias.length,
            description: response.info?.intro?.trim() ?? '',
          };
        },
      }));
    const importedTargets = await this.buildImportedSyncTargets(uid, signal);
    const allTargets = [...ownedTargets, ...importedTargets];
    const requested = new Set(
      (sourceKeys ?? []).map(value => value.trim()).filter(Boolean),
    );
    return requested.size
      ? allTargets.filter(target => requested.has(target.playlistId))
      : allTargets;
  }

  /** 将外部收藏夹和合集转换为共享收藏同步目标。 */
  private async buildImportedSyncTargets(
    uid: string,
    signal?: AbortSignal,
  ): Promise<FavoriteSyncTarget[]> {
    const sources = await this.loadImportedCatalog(uid, signal);
    return sources.map(source => ({
      playlistId: source.sourceKey,
      title: source.title,
      remoteVideoCount: source.mediaCount,
      kind: source.kind,
      ownerMid: source.ownerMid,
      ownerName: source.ownerName,
      cover: source.cover,
      description: source.description,
      fetchPage: async (page: number, pageSignal?: AbortSignal) => {
        if (source.kind === 'collectedFavorite') {
          const response = await this.api.getFavoriteVideos(
            source.remoteId,
            page,
            FAVORITE_PAGE_SIZE,
            pageSignal,
            'index',
          );
          const medias = response.medias ?? [];
          return {
            list: medias
              .filter(media => media.attr === 0)
              .map(media => ({
                ...trimFavoriteVideo(media),
                sourceKeys: [source.sourceKey],
              })),
            hasMore:
              response.has_more === true || medias.length === FAVORITE_PAGE_SIZE,
            rawCount: medias.length,
            description: response.info?.intro?.trim() ?? source.description,
          };
        }
        const response = await this.api.getSeasonArchives(
          source.ownerMid,
          source.remoteId,
          page,
          FAVORITE_PAGE_SIZE,
          pageSignal,
          'index',
        );
        const archives = response.archives ?? [];
        const pageSize = response.page?.page_size ?? FAVORITE_PAGE_SIZE;
        return {
          list: archives
            .map(archive => toSeasonFavoriteVideo(archive, source.sourceKey))
            .filter((video): video is FavoriteVideo => video !== null),
          hasMore:
            response.page?.total !== undefined
              ? page * pageSize < response.page.total
              : archives.length === FAVORITE_PAGE_SIZE,
          rawCount: archives.length,
          description:
            response.meta?.description?.trim() ??
            response.meta?.intro?.trim() ??
            source.description,
        };
      },
    }));
  }

  /** 读取并规范化远端外部收藏来源目录。 */
  private async loadImportedCatalog(
    uid: string,
    signal?: AbortSignal,
  ): Promise<FavoriteSourceSummary[]> {
    const items: BiliCollectedPlaylist[] = [];
    let page = 1;
    let expectedCount = 0;
    while (!signal?.aborted) {
      const response = await this.api.getCollectedPlaylists(
        uid,
        page,
        50,
        signal,
        'index',
      );
      const nextItems = response.list ?? [];
      expectedCount = response.count ?? expectedCount;
      items.push(...nextItems);
      if (
        !nextItems.length ||
        (expectedCount > 0 && items.length >= expectedCount) ||
        nextItems.length < 50
      ) {
        break;
      }
      page += 1;
    }
    const deduplicated = new Map<string, FavoriteSourceSummary>();
    for (const item of items) {
      const source = normalizeImportedSource(item, uid);
      if (!source) {
        continue;
      }
      deduplicated.set(source.sourceKey, source);
    }
    return Array.from(deduplicated.values());
  }

  /** 读取自有收藏夹和外部来源，作为音乐库目录的远端快照。 */
  private async buildSourceCatalog(
    uid: string,
    signal?: AbortSignal,
    localSources = new Map<string, FavoriteSourceSummary>(),
  ): Promise<FavoriteSourceSummary[]> {
    const folderResponse = await this.api.getFavoriteFolders(
      uid,
      signal,
      undefined,
      'index',
    );
    const owned = (folderResponse.list ?? [])
      .filter(folder => folder.id > 0)
      .map(folder => ({
        sourceKey: `ownedFavorite:${folder.id}`,
        kind: 'owned' as const,
        remoteId: folder.id,
        ownerMid: Number(folder.mid ?? uid),
        ownerName: '',
        title: folder.title,
        cover: normalizeBiliAssetUrl(folder.cover ?? ''),
        mediaCount: Math.max(0, folder.media_count),
        description: '',
        syncStatus: 'idle' as const,
        lastSyncedAt: null,
      }));
    const imported = await this.loadImportedCatalog(uid, signal);
    const sources = [...owned, ...imported];
    return Promise.all(
      sources.map(async source => {
        const localCover = localSources.get(source.sourceKey)?.cover ?? '';
        const cover =
          normalizeBiliAssetUrl(source.cover) ||
          normalizeBiliAssetUrl(localCover) ||
          (await this.fetchSourceCover(source, signal));
        return {...source, cover};
      }),
    );
  }

  /** 从来源第一页视频中补齐收藏夹封面，兼容目录接口不返回 cover 的情况。 */
  private async fetchSourceCover(
    source: FavoriteSourceSummary,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) {
      return '';
    }
    try {
      if (source.kind === 'subscribedSeason') {
        const response = await this.api.getSeasonArchives(
          source.ownerMid,
          source.remoteId,
          1,
          FAVORITE_PAGE_SIZE,
          signal,
          'index',
        );
        const archive = (response.archives ?? []).find(
          item => Boolean(item.pic?.trim() || item.cover?.trim()),
        );
        return normalizeBiliAssetUrl(archive?.pic ?? archive?.cover);
      }
      const response = await this.api.getFavoriteVideos(
        source.remoteId,
        1,
        FAVORITE_PAGE_SIZE,
        signal,
        'index',
      );
      const media = (response.medias ?? []).find(
        item => item.attr === 0 && Boolean(item.cover?.trim()),
      );
      return normalizeBiliAssetUrl(media?.cover);
    } catch (error) {
      if (!signal?.aborted) {
        this.logger.warn('library.source-cover-failed', {
          sourceKey: source.sourceKey,
          error,
        });
      }
      return '';
    }
  }

  /** 校验调用方仍持有目标账号，避免账号切换期间写错本地数据。 */
  private async assertCurrentAccount(uid: string): Promise<void> {
    const status = await this.credentials.getStatus();
    if (!status.loggedIn || status.uid !== uid) {
      throw new Error('B 站账号已变化，请重新登录后同步');
    }
  }

  /** 为本地搜索建立可取消请求边界，并记录失败日志。 */
  private async withRequest<T>(
    requestId: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const previous = this.pendingRequests.get(requestId);
    previous?.abort();
    const controller = new AbortController();
    this.pendingRequests.set(requestId, controller);
    try {
      return await work(controller.signal);
    } catch (error) {
      this.logger.warn('library.request-failed', {
        requestId,
        error,
      });
      throw error;
    } finally {
      if (this.pendingRequests.get(requestId) === controller) {
        this.pendingRequests.delete(requestId);
      }
    }
  }
}

/** 将本地收藏视频转换为安全的桌面内容卡片。 */
function toFavoriteDesktopVideo(video: FavoriteVideo): DesktopVideo {
  const sourceKeys = Array.from(
    new Set([
      ...(video.sourceKeys ?? []),
      ...(video.folderIds ?? []).map(folderId => `ownedFavorite:${folderId}`),
    ]),
  );
  return {
    aid: video.aid,
    bvid: video.bvid,
    title: video.title,
    cover: normalizeBiliAssetUrl(video.cover),
    duration: video.duration,
    pubtime: video.pubtime,
    authorId: video.upper.mid,
    author: video.upper.name,
    tags: [],
    page: video.page,
    favTime: video.favTime,
    sourceKeys,
    source: 'favorite',
  };
}

/** 将 B 站外部收藏目录规范化为桌面来源摘要。 */
function normalizeImportedSource(
  item: BiliCollectedPlaylist,
  uid: string,
): FavoriteSourceSummary | null {
  const ownerMid = Number(item.upper?.mid ?? item.mid ?? 0);
  const isSeason =
    (item.fid != null && Number(item.fid) === 0) ||
    item.season_id != null ||
    item.type_name === '合集';
  const remoteId = Number(isSeason ? item.season_id ?? item.id : item.id);
  if (!ownerMid || !remoteId || ownerMid === Number(uid)) {
    return null;
  }
  const kind: FavoriteSourceKind = isSeason
    ? 'subscribedSeason'
    : 'collectedFavorite';
  return {
    sourceKey: getFavoriteSourceKey(kind, ownerMid, remoteId),
    kind,
    remoteId,
    ownerMid,
    ownerName: item.upper?.name ?? '',
    title: item.title ?? item.name ?? '未命名列表',
    cover: normalizeBiliAssetUrl(item.cover ?? ''),
    mediaCount: Math.max(0, Number(item.media_count ?? item.total ?? 0)),
    description: (item.intro ?? item.description ?? '').trim(),
    syncStatus: 'idle',
    lastSyncedAt: null,
  };
}

/** 将合集归档条目转换为共享收藏视频。 */
function toSeasonFavoriteVideo(
  archive: BiliSeasonArchive,
  sourceKey: string,
): FavoriteVideo | null {
  if (!archive.bvid) {
    return null;
  }
  return {
    bvid: archive.bvid,
    aid: archive.aid,
    title: archive.title,
    cover: normalizeBiliAssetUrl(archive.pic ?? archive.cover ?? ''),
    duration: archive.duration ?? 0,
    page: 1,
    pubtime: archive.pubdate ?? archive.ctime ?? 0,
    favTime: 0,
    upper: {
      mid: archive.owner?.mid ?? archive.upper?.mid ?? 0,
      name: archive.owner?.name ?? archive.upper?.name ?? '',
    },
    attr: 0,
    sourceKeys: [sourceKey],
  };
}

export type {LibrarySyncOptions};
