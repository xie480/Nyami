import {
  config,
  filterRecommendedVideos,
  trimFavoriteVideo,
  trimSearchVideo,
  trimVideoTags,
  type BiliApi,
  type BiliCollectedPlaylist,
  type BiliSeasonArchive,
  type FavoriteSyncProgress,
  type FavoriteSyncTarget,
  type FavoriteVideo,
  type ImportedPlaylist,
  type TagRecommendation,
  type VideoTag,
} from '../../../packages/core/src';
import {FavoriteSyncTask} from '../../../packages/core/src/favorites/syncTask';
import type {CredentialStore} from '../auth/credentialStore';
import type {AppLogger} from '../logging/appLogger';
import {
  DesktopLibraryRepository,
  type PlaylistCatalogRecord,
  type RecommendationCollectionRecord,
} from '../storage/desktopLibraryRepository';
import type {
  DesktopVideo,
  RecommendationCollection,
  RecommendationContentRequest,
  RecommendationProfile,
  RecommendationSnapshot,
} from '../../shared/types';

const FAVORITE_PAGE_SIZE = 20;
const COLLECTED_PLAYLIST_PAGE_SIZE = 50;
const TAG_BACKFILL_CONCURRENCY = 4;

type LibrarySyncOptions = {
  force?: boolean;
  signal?: AbortSignal;
  onPhase?: (phase: 'catalog' | 'favorites' | 'tags', total: number) => void;
  onFavoriteProgress?: (progress: FavoriteSyncProgress) => void;
  onTagProgress?: (completed: number, total: number) => void;
};

/**
 * 桌面端收藏同步与本地推荐运行时。
 * 该类组合共享 BiliApi、SQLite Repository 和标签/推荐规则，Renderer 不接触其中任何凭证。
 */
export class DesktopLibraryRuntime {
  private readonly pendingRequests = new Map<string, AbortController>();

  /**
   * 创建桌面业务运行时。
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

  /** 同步自有收藏夹、外部收藏夹、订阅合集和视频标签。 */
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
      config.favoriteSync.playlistConcurrency,
    );
    const progress = await task.run(targets, {
      force: options.force,
      concurrency: config.favoriteSync.playlistConcurrency,
      signal: options.signal,
      onProgress: options.onFavoriteProgress,
    });
    await this.backfillTags(uid, options);
    return progress;
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

  /** 生成首页歌曲与合集推荐，并写入七日推荐历史。 */
  async getRecommendations(
    request: RecommendationContentRequest,
  ): Promise<RecommendationSnapshot> {
    return this.withRequest(request.requestId, async signal => {
      await this.assertCurrentAccount(request.uid);
      this.repository.switchAccount(request.uid);
      const favorites = await this.repository.getGlobalIndex(request.uid);
      const profile = this.buildTagProfile(request.uid, favorites);
      const candidates = await this.searchTagCandidates(
        profile,
        favorites,
        signal,
        request.page ?? 1,
      );
      const filteredVideos = this.repository.filterAndRecordVideos(
        request.uid,
        filterRecommendedVideos(candidates, {
          excludedVideoIds: favorites.map(video => video.bvid),
          excludedVideoTitles: favorites.map(video => video.title),
        }),
        config.recommendations.homeSongPreviewCount,
        config.recommendations.recommendationHistoryTtlMs,
      );
      const collections = this.buildCollectionCandidates(
        this.repository.getPlaylistCatalog(request.uid),
      );
      const filteredCollections = this.repository.filterAndRecordCollections(
        request.uid,
        collections,
        config.recommendations.homePlaylistPreviewCount,
        config.recommendations.recommendationHistoryTtlMs,
      );
      return {
        videos: filteredVideos.map(video => toDesktopVideo(video)),
        collections: filteredCollections.map(toRecommendationCollection),
        profile,
        hasMore: candidates.length >= config.tagRecommendations.maxRecommendations,
        updatedAt: Date.now(),
      };
    });
  }

  /** 取消 Renderer 不再需要的推荐请求。 */
  cancel(requestId: string): void {
    this.pendingRequests.get(requestId)?.abort();
  }

  /** 清理当前账号的本地索引和推荐历史。 */
  clearAccount(uid: string): void {
    this.repository.clearAccount(uid);
  }

  /** 读取并规范化所有自有、外部和订阅来源，转换为共享同步目标。 */
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
    const targets: FavoriteSyncTarget[] = (folderResponse.list ?? [])
      .filter(folder => folder.id > 0)
      .map(folder => ({
        playlistId: `ownedFavorite:${folder.id}`,
        title: folder.title,
        remoteVideoCount: Math.max(0, folder.media_count),
        kind: 'owned',
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

    const imported = await this.loadImportedPlaylists(uid, signal);
    for (const source of imported) {
      targets.push({
        playlistId: source.sourceKey,
        title: source.title,
        remoteVideoCount: source.mediaCount,
        kind: source.kind,
        ownerMid: source.ownerMid,
        ownerName: source.ownerName,
        cover: source.cover,
        description: source.description,
        fetchPage: (page, pageSignal) =>
          this.fetchImportedPage(source, page, pageSignal),
      });
    }
    return targets;
  }

  /** 拉取外部收藏目录全部分页并排除当前账号自己的重复目录。 */
  private async loadImportedPlaylists(
    uid: string,
    signal?: AbortSignal,
  ): Promise<ImportedPlaylist[]> {
    const allItems: BiliCollectedPlaylist[] = [];
    let page = 1;
    let expectedCount = 0;
    while (!signal?.aborted) {
      const response = await this.api.getCollectedPlaylists(
        uid,
        page,
        COLLECTED_PLAYLIST_PAGE_SIZE,
        signal,
        'index',
      );
      const items = response.list ?? [];
      expectedCount = response.count ?? expectedCount;
      allItems.push(...items);
      if (
        items.length === 0 ||
        (expectedCount > 0 && allItems.length >= expectedCount) ||
        items.length < COLLECTED_PLAYLIST_PAGE_SIZE
      ) {
        break;
      }
      page += 1;
    }
    const deduplicated = new Map<string, ImportedPlaylist>();
    for (const item of allItems) {
      const normalized = normalizeImportedPlaylist(item);
      if (!normalized) {
        continue;
      }
      if (
        normalized.kind === 'collectedFavorite' &&
        normalized.ownerMid === Number(uid)
      ) {
        continue;
      }
      deduplicated.set(normalized.sourceKey, normalized);
    }
    return Array.from(deduplicated.values());
  }

  /** 获取外部收藏夹或订阅合集的一页视频。 */
  private async fetchImportedPage(
    source: ImportedPlaylist,
    page: number,
    signal?: AbortSignal,
  ) {
    if (source.kind === 'collectedFavorite') {
      const response = await this.api.getFavoriteVideos(
        source.remoteId,
        page,
        FAVORITE_PAGE_SIZE,
        signal,
        'index',
      );
      const medias = response.medias ?? [];
      return {
        list: medias
          .filter(media => media.attr === 0)
          .map(trimFavoriteVideo)
          .map(video => ({
            ...video,
            sourceKeys: [source.sourceKey],
          })),
        hasMore:
          response.has_more === true || medias.length === FAVORITE_PAGE_SIZE,
        rawCount: medias.length,
        description: response.info?.intro?.trim() ?? source.description ?? '',
      };
    }
    const response = await this.api.getSeasonArchives(
      source.ownerMid,
      source.remoteId,
      page,
      FAVORITE_PAGE_SIZE,
      signal,
      'index',
    );
    const archives = response.archives ?? [];
    const pageInfo = response.page;
    return {
      list: archives
        .map(archive => normalizeSeasonArchive(archive, source))
        .filter((video): video is FavoriteVideo => video !== null),
      hasMore:
        pageInfo?.total != null
          ? page * (pageInfo.page_size ?? FAVORITE_PAGE_SIZE) < pageInfo.total
          : archives.length === FAVORITE_PAGE_SIZE,
      rawCount: archives.length,
      description:
        response.meta?.description?.trim() ??
        response.meta?.intro?.trim() ??
        source.description ??
        '',
    };
  }

  /** 按小并发补齐收藏视频标签并写入缓存，失败只记录下一次重试时间。 */
  private async backfillTags(
    uid: string,
    options: LibrarySyncOptions,
  ): Promise<void> {
    const videos = await this.repository.getGlobalIndex(uid);
    const cache = this.repository.getVideoTagCache(
      uid,
      videos.map(video => video.bvid),
    );
    const now = Date.now();
    const pending = videos.filter(video => {
      const entry = cache.get(video.bvid);
      return !entry ||
        (entry.retryAfter !== null && entry.retryAfter <= now);
    });
    options.onPhase?.('tags', pending.length);
    options.onTagProgress?.(0, pending.length);
    let nextIndex = 0;
    let completed = 0;
    const worker = async (): Promise<void> => {
      while (!options.signal?.aborted) {
        const index = nextIndex++;
        const video = pending[index];
        if (!video) {
          return;
        }
        const fetchedAt = Date.now();
        try {
          const tags = trimVideoTags(
            await this.api.getVideoTags(video.bvid, options.signal),
          );
          this.repository.upsertVideoTagCache(uid, [{
            videoId: video.bvid,
            tags,
            fetchedAt,
            retryAfter: null,
          }]);
        } catch (error) {
          if (options.signal?.aborted) {
            return;
          }
          this.logger.warn('library.tag-backfill-failed', {
            videoId: video.bvid,
            error,
          });
          const previous = cache.get(video.bvid);
          this.repository.upsertVideoTagCache(uid, [{
            videoId: video.bvid,
            tags: previous?.tags ?? [],
            fetchedAt: previous?.fetchedAt ?? null,
            retryAfter: fetchedAt + config.tagRecommendations.transientRetryDelayMs,
          }]);
        } finally {
          completed += 1;
          options.onTagProgress?.(completed, pending.length);
        }
      }
    };
    const workerCount = Math.min(TAG_BACKFILL_CONCURRENCY, pending.length);
    await Promise.all(
      Array.from({length: workerCount}, () => worker()),
    );
    if (options.signal?.aborted) {
      throw createAbortError('标签同步已取消');
    }
  }

  /** 从本地标签缓存计算可解释的收藏兴趣画像。 */
  private buildTagProfile(
    uid: string,
    videos: FavoriteVideo[],
  ): RecommendationProfile {
    const cache = this.repository.getVideoTagCache(
      uid,
      videos.map(video => video.bvid),
    );
    const counts = new Map<string, {
      tagId: number;
      tagName: string;
      videoCount: number;
    }>();
    let taggedVideoCount = 0;
    let resolvedVideoCount = 0;
    for (const video of videos) {
      const entry = cache.get(video.bvid);
      if (!entry) {
        continue;
      }
      resolvedVideoCount += 1;
      const seen = new Set<string>();
      for (const tag of entry.tags) {
        const key = tag.tagName.trim().toLocaleLowerCase();
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        const current = counts.get(key);
        counts.set(key, {
          tagId: current?.tagId ?? tag.tagId,
          tagName: current?.tagName ?? tag.tagName,
          videoCount: (current?.videoCount ?? 0) + 1,
        });
      }
      if (seenHasAnyTag(entry.tags)) {
        taggedVideoCount += 1;
      }
    }
    const preferences = Array.from(counts.values())
      .map(tag => ({
        ...tag,
        score: taggedVideoCount > 0 ? tag.videoCount / taggedVideoCount : 0,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.videoCount - left.videoCount ||
          left.tagName.localeCompare(right.tagName, 'zh-CN'),
      );
    return {
      totalVideoCount: videos.length,
      resolvedVideoCount,
      taggedVideoCount,
      pendingVideoCount: Math.max(0, videos.length - resolvedVideoCount),
      preferences,
    };
  }

  /** 根据画像 Top tags 搜索音乐分区并合并重复 BVID。 */
  private async searchTagCandidates(
    profile: RecommendationProfile,
    favorites: FavoriteVideo[],
    signal: AbortSignal | undefined,
    page: number,
  ): Promise<TagRecommendation[]> {
    const queries = profile.preferences.length > 0
      ? profile.preferences
          .slice(0, config.tagRecommendations.maxProfileTags)
          .map(preference => preference.tagName)
      : ['音乐'];
    const favoriteIds = new Set(favorites.map(video => video.bvid));
    const favoriteTitles = new Set(
      favorites.map(video => normalizeTitle(video.title)),
    );
    const byId = new Map<string, TagRecommendation>();
    const responses = await Promise.all(
      queries.map(async query => {
        const response = await this.api.searchVideos(
          query,
          page,
          signal,
          config.tagRecommendations.musicTid,
        );
        return {query, response};
      }),
    );
    for (const {query, response} of responses) {
      for (const item of response.result ?? []) {
        const video = trimSearchVideo(item);
        if (
          !video.bvid ||
          favoriteIds.has(video.bvid) ||
          favoriteTitles.has(normalizeTitle(video.title))
        ) {
          continue;
        }
        const matchedTags = video.tags.filter(tag =>
          queries.some(queryValue => normalizeTag(queryValue) === normalizeTag(tag)),
        );
        if (matchedTags.length === 0) {
          matchedTags.push(query);
        }
        const score = matchedTags.reduce(
          (total, tag) =>
            total +
            (profile.preferences.find(
              preference => normalizeTag(preference.tagName) === normalizeTag(tag),
            )?.score ?? 0.1),
          0,
        );
        const recommendation: TagRecommendation = {
          ...video,
          matchedTags: Array.from(new Set(matchedTags)),
          score,
        };
        const previous = byId.get(video.bvid);
        if (!previous || recommendation.score > previous.score) {
          byId.set(video.bvid, recommendation);
        }
      }
    }
    return Array.from(byId.values()).sort(
      (left, right) => right.score - left.score || right.pubtime - left.pubtime,
    );
  }

  /** 依据本地同步来源生成可记录的合集候选。 */
  private buildCollectionCandidates(
    records: PlaylistCatalogRecord[],
  ): Array<RecommendationCollectionRecord> {
    return records
      .filter(record => record.kind !== 'owned')
      .map(record => ({
        sourceKey: record.playlistId,
        kind: record.kind === 'subscribedSeason'
          ? 'subscribedSeason'
          : 'collectedFavorite',
        remoteId: 0,
        ownerMid: record.ownerMid,
        ownerName: record.ownerName,
        title: record.title,
        cover: record.cover,
        mediaCount: record.remoteVideoCount,
        description: record.description,
        score: record.remoteVideoCount,
        matchedTags: [],
      }));
  }

  /** 校验调用方仍持有目标账号，避免账号切换期间写错本地数据。 */
  private async assertCurrentAccount(uid: string): Promise<void> {
    const status = await this.credentials.getStatus();
    if (!status.loggedIn || status.uid !== uid) {
      throw new Error('B 站账号已变化，请重新登录后同步');
    }
  }

  /** 为推荐请求建立 AbortController，避免旧账号或旧首页结果覆盖新请求。 */
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
    } finally {
      if (this.pendingRequests.get(requestId) === controller) {
        this.pendingRequests.delete(requestId);
      }
    }
  }
}

/** 将 B 站收藏目录条目转换为共享外部来源模型。 */
function normalizeImportedPlaylist(
  item: BiliCollectedPlaylist,
): ImportedPlaylist | null {
  const ownerMid = Number(item.upper?.mid ?? item.mid ?? 0);
  const isSeason =
    (item.fid != null && Number(item.fid) === 0) ||
    item.season_id != null ||
    item.type_name === '合集';
  const remoteId = Number(isSeason ? item.season_id ?? item.id : item.id);
  if (!ownerMid || !remoteId) {
    return null;
  }
  const kind = isSeason ? 'subscribedSeason' : 'collectedFavorite';
  const description =
    typeof item.intro === 'string'
      ? item.intro
      : typeof item.description === 'string'
        ? item.description
        : '';
  return {
    sourceKey: `${kind}:${ownerMid}:${remoteId}`,
    kind,
    remoteId,
    ownerMid,
    ownerName: item.upper?.name ?? '',
    title: item.title ?? item.name ?? '未命名列表',
    cover: item.cover ?? '',
    mediaCount: Number(item.media_count ?? item.total ?? 0),
    description: description.trim(),
  };
}

/** 将订阅合集归档条目转换为收藏视频模型。 */
function normalizeSeasonArchive(
  archive: BiliSeasonArchive,
  source: ImportedPlaylist,
): FavoriteVideo | null {
  if (!archive.bvid) {
    return null;
  }
  return {
    bvid: archive.bvid,
    aid: archive.aid,
    title: archive.title,
    cover: archive.pic ?? archive.cover ?? '',
    duration: archive.duration ?? 0,
    page: 1,
    pubtime: archive.pubdate ?? archive.ctime ?? 0,
    favTime: 0,
    upper: {
      mid: archive.owner?.mid ?? archive.upper?.mid ?? source.ownerMid,
      name: archive.owner?.name ?? archive.upper?.name ?? source.ownerName,
    },
    attr: 0,
    sourceKeys: [source.sourceKey],
  };
}

/** 将共享推荐视频转换为安全的桌面内容卡片。 */
function toDesktopVideo(video: TagRecommendation): DesktopVideo {
  return {
    aid: video.aid,
    bvid: video.bvid,
    title: video.title,
    cover: video.cover,
    duration: video.duration,
    pubtime: video.pubtime,
    authorId: video.authorId,
    author: video.author,
    tags: video.tags,
    source: 'recommendation',
  };
}

/** 将合集领域模型转换为 Renderer 展示模型。 */
function toRecommendationCollection(
  collection: RecommendationCollectionRecord,
): RecommendationCollection {
  return {
    sourceKey: collection.sourceKey,
    title: collection.title,
    cover: collection.cover,
    mediaCount: collection.mediaCount,
    ownerName: collection.ownerName,
    description: collection.description,
    score: collection.score,
  };
}

/** 将标题转换为推荐去重键。 */
function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\u3000]+/g, '')
    .toLocaleLowerCase();
}

/** 将 tag 转换为大小写不敏感的比较键。 */
function normalizeTag(value: string): string {
  return value.trim().replace(/[\s\u3000]+/g, '').toLocaleLowerCase();
}

/** 判断一个标签缓存条目是否包含可用于画像的标签。 */
function seenHasAnyTag(tags: readonly VideoTag[]): boolean {
  return tags.some(tag => Boolean(tag.tagName.trim()));
}

/** 为取消的后台任务生成标准 AbortError。 */
function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export type {LibrarySyncOptions};
