import {
  trimFavoriteVideo,
  type BiliCollectedPlaylist,
  type BiliSeasonArchive,
  type BiliApi,
  type FavoriteSyncProgress,
  type FavoriteSyncTarget,
  type FavoriteVideo,
  type PageResult,
} from '../../../packages/core/src';
import {FavoriteSyncTask} from '../../../packages/core/src/favorites/syncTask';
import type {CredentialStore} from '../auth/credentialStore';
import {
  DESKTOP_SYNC_PAGE_CONCURRENCY,
  DESKTOP_SYNC_PLAYLIST_CONCURRENCY,
} from '../constants';
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

/** Android 端收藏分页缓存时长，避免短时间重复刷新同一来源。 */
const SYNC_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Bilibili 导入来源目录接口的单页大小。 */
const IMPORTED_CATALOG_PAGE_SIZE = 50;

/** 导入来源目录允许读取的最大分页数，防止异常分页响应造成无限请求。 */
const MAX_IMPORTED_CATALOG_PAGES = 200;

type LibrarySyncOptions = {
  force?: boolean;
  signal?: AbortSignal;
  sourceKeys?: readonly string[];
  onPhase?: (phase: 'catalog' | 'favorites', total: number) => void;
  onFavoriteProgress?: (progress: FavoriteSyncProgress) => void;
};

type CachedSyncPage = {
  expiresAt: number;
  result: PageResult<FavoriteVideo>;
};

/**
 * 桌面端轻量收藏索引运行时。
 * 该类同步当前账号可访问的收藏来源，并把本地索引读取交给 SQLite。
 */
export class DesktopLibraryRuntime {
  private readonly pendingRequests = new Map<string, AbortController>();

  private readonly syncPageCache = new Map<string, CachedSyncPage>();

  private syncTail: Promise<void> = Promise.resolve();

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
    return this.withSyncMutex(options.signal, async () => {
      await this.assertCurrentAccount(uid);
      this.repository.switchAccount(uid);
      options.onPhase?.('catalog', 0);
      const targets = await this.buildSyncTargets(
        uid,
        options.signal,
        options.sourceKeys,
        options.force === true,
      );
      options.onPhase?.('favorites', targets.length);
      const task = new FavoriteSyncTask(
        this.repository,
        DESKTOP_SYNC_PLAYLIST_CONCURRENCY,
      );
      return task.run(targets, {
        force: options.force,
        concurrency: DESKTOP_SYNC_PLAYLIST_CONCURRENCY,
        pageConcurrency: DESKTOP_SYNC_PAGE_CONCURRENCY,
        signal: options.signal,
        onProgress: options.onFavoriteProgress,
      });
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
      this.syncPageCache.clear();
      return;
    }
    this.syncPageCache.clear();
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
        const requested = new Set(
          (sourceKeys ?? []).map(value => value.trim()).filter(Boolean),
        );
        const remoteSources = await this.buildSourceCatalog(
          uid,
          signal,
          localSources,
          requested,
        );
        return remoteSources
          .filter(source => !requested.size || requested.has(source.sourceKey))
          .map(source => {
            const local = localSources.get(source.sourceKey);
            return {
              ...source,
              mediaCount:
                local?.syncStatus === 'success'
                  ? local.mediaCount
                  : source.mediaCount,
              syncStatus: local?.syncStatus ?? 'idle',
              lastSyncedAt: local?.lastSyncedAt ?? null,
            };
          });
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
      async signal => {
        await this.assertCurrentAccount(uid);
        this.repository.switchAccount(uid);
        const result = this.repository.getSourceVideos(
          uid,
          sourceKey,
          page,
          FAVORITE_PAGE_SIZE,
        );
        const localSource = this.repository
          .getSourceSummaries(uid, [sourceKey])
          .find(source => source.sourceKey === sourceKey);
        if (result.total === 0 && localSource?.syncStatus !== 'success') {
          return this.fetchRemoteSourceVideos(
            sourceKey,
            page,
            signal,
          );
        }
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

  /** 删除当前账号指定收藏来源的本地索引，不修改 Bilibili 远端收藏关系。 */
  async deleteSourceIndexes(
    uid: string,
    sourceKeys: readonly string[],
    requestId?: string,
  ): Promise<void> {
    await this.withRequest(
      requestId ?? `delete-source-indexes:${uid}`,
      async signal => {
        await this.assertCurrentAccount(uid);
        if (signal.aborted) {
          throw createAbortError('删除收藏索引已取消');
        }
        this.repository.switchAccount(uid);
        this.repository.deletePlaylistIndexes(sourceKeys);
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
    force = false,
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
        fetchPage: (page: number, pageSignal?: AbortSignal) =>
          this.getCachedSyncPage(
            uid,
            `ownedFavorite:${folder.id}`,
            page,
            force,
            pageSignal,
            async () => {
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
                remoteVideoCount: Math.max(
                  0,
                  response.info?.media_count ?? folder.media_count,
                ),
                description: response.info?.intro?.trim() ?? '',
              };
            },
          ),
      }));
    const requested = new Set(
      (sourceKeys ?? []).map(value => value.trim()).filter(Boolean),
    );
    const requestedImported = new Set(
      Array.from(requested).filter(sourceKey => {
        const target = parseFavoriteSourceTarget(sourceKey);
        return target !== null && target.kind !== 'owned';
      }),
    );
    const importedTargets = requested.size && !requestedImported.size
      ? []
      : await this.buildImportedSyncTargets(
          uid,
          signal,
          force,
          requestedImported,
        );
    const allTargets = [...ownedTargets, ...importedTargets];
    return requested.size
      ? allTargets.filter(target => requested.has(target.playlistId))
      : allTargets;
  }

  /** 将外部收藏夹和合集转换为共享收藏同步目标。 */
  private async buildImportedSyncTargets(
    uid: string,
    signal?: AbortSignal,
    force = false,
    requestedSourceKeys = new Set<string>(),
  ): Promise<FavoriteSyncTarget[]> {
    const sources = await this.loadImportedCatalog(
      uid,
      signal,
      requestedSourceKeys,
    );
    return sources.map(source => ({
      playlistId: source.sourceKey,
      title: source.title,
      remoteVideoCount: source.mediaCount,
      kind: source.kind,
      ownerMid: source.ownerMid,
      ownerName: source.ownerName,
      cover: source.cover,
      description: source.description,
      fetchPage: (page: number, pageSignal?: AbortSignal) =>
        this.getCachedSyncPage(
          uid,
          source.sourceKey,
          page,
          force,
          pageSignal,
          async () => {
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
                remoteVideoCount: Math.max(
                  0,
                  response.info?.media_count ?? source.mediaCount,
                ),
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
              remoteVideoCount: Math.max(
                0,
                response.page?.total ?? source.mediaCount,
              ),
              description:
                response.meta?.description?.trim() ??
                response.meta?.intro?.trim() ??
                source.description,
            };
          },
        ),
    }));
  }

  /** 读取并规范化远端外部收藏来源目录。 */
  private async loadImportedCatalog(
    uid: string,
    signal?: AbortSignal,
    requestedSourceKeys = new Set<string>(),
  ): Promise<FavoriteSourceSummary[]> {
    const items: BiliCollectedPlaylist[] = [];
    let page = 1;
    let expectedCount = 0;
    let previousPageSignature = '';
    let completed = false;
    while (!signal?.aborted && page <= MAX_IMPORTED_CATALOG_PAGES) {
      const response = await this.api.getCollectedPlaylists(
        uid,
        page,
        IMPORTED_CATALOG_PAGE_SIZE,
        signal,
        'index',
      );
      const nextItems = response.list ?? [];
      expectedCount = response.count ?? expectedCount;
      const pageSignature = getCollectedPageSignature(nextItems);
      if (pageSignature && pageSignature === previousPageSignature) {
        this.logger.warn('library.source-catalog-repeated-page', {
          uid,
          page,
        });
        completed = true;
        break;
      }
      previousPageSignature = pageSignature;
      items.push(...nextItems);
      if (requestedSourceKeys.size) {
        const foundKeys = new Set(
          items
            .map(item => normalizeImportedSource(item, uid)?.sourceKey)
            .filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
        );
        if (
          Array.from(requestedSourceKeys).every(sourceKey =>
            foundKeys.has(sourceKey),
          )
        ) {
          completed = true;
          break;
        }
      }
      if (
        !nextItems.length ||
        (expectedCount > 0 && items.length >= expectedCount) ||
        nextItems.length < IMPORTED_CATALOG_PAGE_SIZE
      ) {
        completed = true;
        break;
      }
      page += 1;
    }
    if (!completed && !signal?.aborted) {
      this.logger.warn('library.source-catalog-page-limit', {
        uid,
        maxPages: MAX_IMPORTED_CATALOG_PAGES,
      });
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
    requestedSourceKeys = new Set<string>(),
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
    const requestedImportedKeys = new Set(
      Array.from(requestedSourceKeys).filter(sourceKey => {
        const target = parseFavoriteSourceTarget(sourceKey);
        return target !== null && target.kind !== 'owned';
      }),
    );
    const imported = requestedSourceKeys.size && !requestedImportedKeys.size
      ? []
      : await this.loadImportedCatalog(
          uid,
          signal,
          requestedImportedKeys,
        );
    const sources = [...owned, ...imported];
    return Promise.all(
      sources.map(async source => {
        const localCover = localSources.get(source.sourceKey)?.cover ?? '';
        // 全量目录只读取元数据，避免为每个来源补第一页封面而阻塞音乐库；详情页再按来源补齐。
        const cover =
          normalizeBiliAssetUrl(source.cover) ||
          normalizeBiliAssetUrl(localCover) ||
          (requestedSourceKeys.has(source.sourceKey)
            ? await this.fetchSourceCover(source, signal)
            : '');
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
        'background',
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

  /** 未建立本地索引时读取单个来源的远端视频分页。 */
  private async fetchRemoteSourceVideos(
    sourceKey: string,
    page: number,
    signal: AbortSignal,
  ): Promise<DesktopPage<DesktopVideo>> {
    const target = parseFavoriteSourceTarget(sourceKey);
    if (!target) {
      return {
        items: [],
        page,
        hasMore: false,
        total: 0,
      };
    }

    if (target.kind === 'subscribedSeason') {
      const response = await this.api.getSeasonArchives(
        target.ownerMid,
        target.remoteId,
        page,
        FAVORITE_PAGE_SIZE,
        signal,
        'normal',
      );
      const archives = response.archives ?? [];
      const pageSize = response.page?.page_size ?? FAVORITE_PAGE_SIZE;
      const total = response.page?.total ?? null;
      const videos = archives
        .map(archive => toSeasonFavoriteVideo(archive, sourceKey))
        .filter((video): video is FavoriteVideo => video !== null)
        .map(video => toFavoriteDesktopVideo(video));
      return {
        items: videos,
        page,
        hasMore:
          total !== null
            ? page * pageSize < total
            : archives.length === FAVORITE_PAGE_SIZE,
        total,
      };
    }

    const response = await this.api.getFavoriteVideos(
      target.remoteId,
      page,
      FAVORITE_PAGE_SIZE,
      signal,
      'normal',
    );
    const medias = response.medias ?? [];
    const videos = medias
      .filter(media => media.attr === 0)
      .map(media => ({
        ...trimFavoriteVideo(media),
        sourceKeys: [sourceKey],
      }))
      .map(video => toFavoriteDesktopVideo(video));
    const total = response.info?.media_count ?? null;
    return {
      items: videos,
      page,
      hasMore:
        response.has_more === true || medias.length === FAVORITE_PAGE_SIZE,
      total,
      description: response.info?.intro?.trim() ?? '',
    };
  }

  /** 复用 Android 端的分页缓存，强制同步时绕过旧缓存并写入新快照。 */
  private async getCachedSyncPage(
    uid: string,
    sourceKey: string,
    page: number,
    force: boolean,
    signal: AbortSignal | undefined,
    loader: () => Promise<PageResult<FavoriteVideo>>,
  ): Promise<PageResult<FavoriteVideo>> {
    const cacheKey = `${uid}:${sourceKey}:${page}`;
    const cached = this.syncPageCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return clonePageResult(cached.result);
    }
    if (force) {
      this.syncPageCache.delete(cacheKey);
    }
    const result = await loader();
    if (!signal?.aborted) {
      this.syncPageCache.set(cacheKey, {
        expiresAt: Date.now() + SYNC_PAGE_CACHE_TTL_MS,
        result: clonePageResult(result),
      });
    }
    return result;
  }

  /** 串行化所有索引同步入口，避免手动刷新与后台同步叠加请求。 */
  private async withSyncMutex<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      throw createAbortError('收藏同步已取消');
    }
    const previous = this.syncTail;
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    this.syncTail = previous.then(() => current);

    let abortListener: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<never>((_resolve, reject) => {
          abortListener = () => reject(createAbortError('收藏同步已取消'));
          signal.addEventListener('abort', abortListener, {once: true});
        })
      : null;
    try {
      await (abortPromise
        ? Promise.race([previous, abortPromise])
        : previous);
    } catch (error) {
      release();
      throw error;
    } finally {
      if (abortListener) {
        signal?.removeEventListener('abort', abortListener);
      }
    }
    if (signal?.aborted) {
      release();
      throw createAbortError('收藏同步已取消');
    }
    try {
      return await work();
    } finally {
      release();
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

/** 创建可被 IPC 取消处理识别的请求异常。 */
function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** 复制收藏分页结果，避免缓存快照被同步写入过程意外修改。 */
function clonePageResult(
  result: PageResult<FavoriteVideo>,
): PageResult<FavoriteVideo> {
  return {
    ...result,
    list: [...result.list],
  };
}

/** 生成导入来源分页签名，用于识别接口重复返回同一页。 */
function getCollectedPageSignature(
  items: readonly BiliCollectedPlaylist[],
): string {
  return items
    .map(
      item =>
        `${item.id}:${item.season_id ?? 0}:${
          item.mid ?? item.upper?.mid ?? 0
        }`,
    )
    .join('|');
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

/** 从稳定来源键解析远端收藏夹类型和数字 ID。 */
function parseFavoriteSourceTarget(
  sourceKey: string,
):
  | {
      kind: 'owned' | 'collectedFavorite';
      remoteId: number;
    }
  | {
      kind: 'subscribedSeason';
      ownerMid: number;
      remoteId: number;
    }
  | null {
  const parts = sourceKey.split(':');
  const remoteId = Number(parts.at(-1));
  if (!Number.isSafeInteger(remoteId) || remoteId <= 0) {
    return null;
  }
  if (parts.length === 2 && parts[0] === 'ownedFavorite') {
    return {kind: 'owned', remoteId};
  }
  if (parts.length !== 3) {
    return null;
  }
  const ownerMid = Number(parts[1]);
  if (!Number.isSafeInteger(ownerMid) || ownerMid <= 0) {
    return null;
  }
  if (parts[0] === 'subscribedSeason') {
    return {kind: 'subscribedSeason', ownerMid, remoteId};
  }
  if (parts[0] === 'collectedFavorite') {
    return {kind: 'collectedFavorite', remoteId};
  }
  return null;
}

export type {LibrarySyncOptions};
