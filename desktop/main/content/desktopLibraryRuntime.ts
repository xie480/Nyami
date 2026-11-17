import {
  trimFavoriteVideo,
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
  FavoriteSearchContentRequest,
} from '../../shared/types';

const FAVORITE_PAGE_SIZE = 20;

type LibrarySyncOptions = {
  force?: boolean;
  signal?: AbortSignal;
  onPhase?: (phase: 'catalog' | 'favorites', total: number) => void;
  onFavoriteProgress?: (progress: FavoriteSyncProgress) => void;
};

/**
 * 桌面端轻量收藏索引运行时。
 * 该类只同步当前账号的自有收藏夹，并把本地搜索交给 SQLite 索引。
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

  /** 同步当前账号的自有收藏夹，建立轻量本地收藏索引。 */
  async synchronize(
    uid: string,
    options: LibrarySyncOptions = {},
  ): Promise<FavoriteSyncProgress> {
    await this.assertCurrentAccount(uid);
    this.repository.switchAccount(uid);
    options.onPhase?.('catalog', 0);
    const targets = await this.buildSyncTargets(uid, options.signal);
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
  ): Promise<FavoriteSyncTarget[]> {
    const folderResponse = await this.api.getFavoriteFolders(
      uid,
      signal,
      undefined,
      'index',
    );
    return (folderResponse.list ?? [])
      .filter(folder => folder.id > 0)
      .map(folder => ({
        playlistId: `ownedFavorite:${folder.id}`,
        title: folder.title,
        remoteVideoCount: Math.max(0, folder.media_count),
        kind: 'owned' as const,
        ownerMid: folder.mid,
        ownerName: '',
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
    source: 'favorite',
  };
}

export type {LibrarySyncOptions};
