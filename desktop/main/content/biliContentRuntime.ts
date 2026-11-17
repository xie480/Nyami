import {
  config,
  createBiliApi,
  createBiliHttpClient,
  AdaptiveRateLimiter,
  trimFavoriteVideo,
  trimFolder,
  trimPopularVideo,
  trimSearchVideo,
  WbiSigner,
  type BiliApi,
  type OnlineVideoSearchResult,
} from '../../../packages/core/src';
import type {
  CredentialStore as CredentialStorePort,
  KeyValueStore,
} from '../../../packages/platform-contracts/src';
import type {
  ContentRequestBase,
  DesktopPage,
  DesktopVideo,
  DiscoverContentRequest,
  FavoriteFolderContentRequest,
  FavoriteFolderSummary,
  FavoriteVideoContentRequest,
  HomeSnapshot,
  SearchContentRequest,
  UserProfile,
} from '../../shared/types';
import {CredentialStore} from '../auth/credentialStore';
import {
  DESKTOP_INDEX_RATE_BURST,
  DESKTOP_INDEX_RATE_LIMIT,
} from '../constants';
import {AppLogger} from '../logging/appLogger';
import {normalizeBiliAssetUrl} from '../security/urlPolicy';

/** 桌面端 WBI 密钥缓存，生命周期与主进程一致。 */
class MemoryKeyValueStore implements KeyValueStore {
  private readonly values = new Map<string, string>();

  /** 读取字符串缓存。 */
  getString(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  /** 写入字符串缓存。 */
  setString(key: string, value: string): void {
    this.values.set(key, value);
  }

  /** 删除字符串缓存。 */
  delete(key: string): void {
    this.values.delete(key);
  }

  /** 判断缓存键是否存在。 */
  contains(key: string): boolean {
    return this.values.has(key);
  }
}

/**
 * 桌面端内容运行时。
 * 主进程统一承载 Bilibili HTTP、WBI、账号凭证和可取消内容请求，Renderer 只接收脱敏领域数据。
 */
export class BiliContentRuntime {
  private readonly api: BiliApi;

  private readonly pendingRequests = new Map<string, AbortController>();

  /** 创建共享核心的桌面适配器。 */
  constructor(
    private readonly credentials: CredentialStore,
    private readonly logger: AppLogger,
    private readonly onAuthRequired?: () => void,
  ) {
    const credentialPort: CredentialStorePort = {
      getCredentials: () => this.credentials.getCredentials(),
      saveCredentials: (cookie, refreshToken) =>
        this.credentials.saveCredentials(cookie, refreshToken),
      clearCredentials: () => this.credentials.clearCredentials(),
    };
    const http = createBiliHttpClient({
      baseUrl: config.biliBaseURL,
      userAgent: config.userAgent,
      referer: config.referer,
      timeoutMs: config.httpTimeout,
      retries: 2,
      retryDelayMs: config.retry.delayMs,
      totalTimeoutMs: config.retry.totalTimeoutMs,
      credentials: credentialPort,
      rateLimiter: new AdaptiveRateLimiter(
        DESKTOP_INDEX_RATE_LIMIT,
        DESKTOP_INDEX_RATE_BURST,
      ),
      onAuthRequired: () => this.onAuthRequired?.(),
    });
    const keyValueStore = new MemoryKeyValueStore();
    const wbi = new WbiSigner(
      async () => {
        const response = await http.get<{
          wbi_img?: {
            img_url?: string;
            sub_url?: string;
          };
        }>('/x/web-interface/nav', {silent: true}, 1);
        const imgKey = extractWbiKey(response.wbi_img?.img_url);
        const subKey = extractWbiKey(response.wbi_img?.sub_url);
        if (!imgKey || !subKey) {
          throw new Error('获取 WBI 密钥失败');
        }
        return {imgKey, subKey};
      },
      keyValueStore,
      config.cacheTTL.wbiKeys,
    );
    this.api = createBiliApi({
      http,
      wbi,
      credentials: credentialPort,
    });
  }

  /**
   * 向主进程其它业务运行时提供同一份 API 组合结果。
   * Renderer 不会获得该引用，因此不会扩大 IPC 暴露面。
   * @returns 已绑定主进程凭证的共享 BiliApi
   */
  getApiForMainProcess(): BiliApi {
    return this.api;
  }

  /** 读取登录账号的公开资料。 */
  async getProfile(): Promise<UserProfile | null> {
    const status = await this.credentials.getStatus();
    if (!status.loggedIn) {
      return null;
    }
    const info = await this.api.getUserInfo(true);
    return {
      uid: info.uid,
      name: info.name,
      avatar: normalizeBiliAssetUrl(info.avatar),
      vipStatus: info.vipStatus,
    };
  }

  /** 加载首页首屏公开内容。 */
  async getHome(request: ContentRequestBase): Promise<HomeSnapshot> {
    return this.withRequest(request.requestId, 'home', async signal => {
      const response = await this.api.getPopularVideos(1, 16, signal);
      const videos = (response.list ?? [])
        .filter(item => item.aid > 0 && Boolean(item.bvid))
        .map(trimPopularVideo)
        .map(video => toDesktopVideo(video, 'popular'));
      return {
        featured: videos.slice(0, 4),
        popular: videos.slice(4),
      };
    });
  }

  /** 加载发现页热门视频分页。 */
  async getDiscover(
    request: DiscoverContentRequest,
  ): Promise<DesktopPage<DesktopVideo>> {
    return this.withRequest(request.requestId, 'discover', async signal => {
      const response = await this.api.getPopularVideos(request.page, 20, signal);
      const items = (response.list ?? [])
        .filter(item => item.aid > 0 && Boolean(item.bvid))
        .map(trimPopularVideo)
        .map(video => toDesktopVideo(video, 'popular'));
      return {
        items,
        page: request.page,
        hasMore: response.no_more !== true && items.length > 0,
        total: null,
      };
    });
  }

  /** 加载公开搜索结果分页，并支持主进程中止请求。 */
  async search(
    request: SearchContentRequest,
  ): Promise<DesktopPage<DesktopVideo>> {
    return this.withRequest(request.requestId, 'search', async signal => {
      const response = await this.api.searchVideos(
        request.keyword,
        request.page,
        signal,
      );
      const items = (response.result ?? [])
        .filter(item => item.aid > 0 && Boolean(item.bvid))
        .map(trimSearchVideo)
        .map(video => toDesktopVideo(video, 'search'));
      const totalPages = response.numPages ?? request.page;
      return {
        items,
        page: request.page,
        hasMore: request.page < totalPages,
        total: response.numResults ?? null,
      };
    });
  }

  /** 加载当前账号自有收藏夹目录。 */
  async getFavoriteFolders(
    request: FavoriteFolderContentRequest,
  ): Promise<FavoriteFolderSummary[]> {
    return this.withRequest(request.requestId, 'favorite-folders', async signal => {
      await this.assertCurrentAccount(request.uid);
      const response = await this.api.getFavoriteFolders(request.uid, signal);
      return (response.list ?? []).map(folder => {
        const normalized = trimFolder(folder);
        return {
          id: normalized.id,
          fid: normalized.fid,
          title: normalized.title,
          mediaCount: normalized.mediaCount,
        };
      });
    });
  }

  /** 加载当前账号收藏夹的视频分页。 */
  async getFavoriteVideos(
    request: FavoriteVideoContentRequest,
  ): Promise<DesktopPage<DesktopVideo>> {
    return this.withRequest(request.requestId, 'favorite-videos', async signal => {
      await this.assertCurrentAccount(request.uid);
      const response = await this.api.getFavoriteVideos(
        request.mediaId,
        request.page,
        20,
        signal,
      );
      const items = (response.medias ?? [])
        .filter(video => video.attr === 0 && Boolean(video.bvid))
        .map(trimFavoriteVideo)
        .map(video => toFavoriteDesktopVideo(video));
      return {
        items,
        page: request.page,
        hasMore: response.has_more === true,
        total: response.info?.media_count ?? null,
        description: response.info?.intro?.trim() || undefined,
      };
    });
  }

  /** 取消一个仍在主进程运行的内容请求。 */
  cancel(request: ContentRequestBase): void {
    const controller = this.pendingRequests.get(request.requestId);
    controller?.abort();
  }

  /** 为请求建立 AbortController，并统一记录可恢复错误。 */
  private async withRequest<T>(
    requestId: string,
    feature: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const previous = this.pendingRequests.get(requestId);
    previous?.abort();
    const controller = new AbortController();
    this.pendingRequests.set(requestId, controller);
    try {
      return await work(controller.signal);
    } catch (error) {
      this.logger.warn('content.request-failed', {
        feature,
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

  /** 防止账号切换后旧页面读取新的账号收藏数据。 */
  private async assertCurrentAccount(uid: string): Promise<void> {
    const status = await this.credentials.getStatus();
    if (!status.loggedIn || status.uid !== uid) {
      throw new Error('B 站账号已变化，请刷新登录状态后重试');
    }
  }
}

/** 从 B 站图片地址中提取 WBI 文件名密钥。 */
function extractWbiKey(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const fileName = value.slice(value.lastIndexOf('/') + 1);
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
}

/** 将共享视频模型转换为跨进程安全模型。 */
function toDesktopVideo(
  video: OnlineVideoSearchResult,
  source: DesktopVideo['source'],
): DesktopVideo {
  return {
    aid: video.aid,
    bvid: video.bvid,
    title: video.title,
    cover: normalizeBiliAssetUrl(video.cover),
    duration: video.duration,
    pubtime: video.pubtime,
    authorId: video.authorId,
    author: video.author,
    tags: video.tags,
    source,
  };
}

/** 将收藏视频模型转换为跨进程安全模型。 */
function toFavoriteDesktopVideo(video: ReturnType<typeof trimFavoriteVideo>): DesktopVideo {
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

