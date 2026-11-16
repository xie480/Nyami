import {trimFolder, trimFavoriteVideo} from '../transformers';
import type {FavoriteFolder, PageResult} from '../types/domain';
import type {
  FavoriteRepository,
  FavoriteSyncTarget,
  FavoriteSyncTaskOptions,
} from './contracts';
import {FavoriteSyncTask} from './syncTask';
import type {BiliApi} from '../api/biliApi';

/**
 * 收藏业务用例门面。
 * 页面只依赖这里的读写和同步方法，不直接访问 Bilibili API 或数据库驱动。
 */
export class FavoriteUseCases {
  constructor(
    private readonly api: BiliApi,
    private readonly repository: FavoriteRepository,
    private readonly syncTask = new FavoriteSyncTask(repository),
  ) {}

  /** 获取并转换当前账号的自有收藏夹。 */
  async getFolders(
    uid: string,
    signal?: AbortSignal,
  ): Promise<FavoriteFolder[]> {
    const response = await this.api.getFavoriteFolders(uid, signal);
    return (response.list ?? []).map(trimFolder);
  }

  /** 获取并转换收藏夹视频分页。 */
  async getVideos(
    mediaId: string | number,
    page = 1,
    pageSize = 20,
    signal?: AbortSignal,
  ): Promise<PageResult<ReturnType<typeof trimFavoriteVideo>>> {
    const response = await this.api.getFavoriteVideos(
      mediaId,
      page,
      pageSize,
      signal,
    );
    const medias = response.medias ?? [];
    return {
      list: medias.filter(video => video.attr === 0).map(trimFavoriteVideo),
      hasMore: response.has_more,
      rawCount: medias.length,
      description: response.info?.intro,
    };
  }

  /** 将远端目录分页同步到注入的收藏仓储。 */
  async sync(
    targets: FavoriteSyncTarget[],
    options: FavoriteSyncTaskOptions = {},
  ) {
    return this.syncTask.run(targets, options);
  }

  /** 写入前统一走共享 API 的账号校验。 */
  async addVideo(uid: string, aid: number, folderIds: number[]): Promise<void> {
    await this.api.addVideoToFavoriteFolders(uid, aid, folderIds);
  }

  /** 取消收藏前统一走共享 API 的账号校验。 */
  async removeVideo(uid: string, aid: number, folderId: number): Promise<void> {
    await this.api.removeVideoFromFavoriteFolder(uid, aid, folderId);
  }

  /** 暴露仓储引用给平台任务面板或数据清理流程。 */
  getRepository(): FavoriteRepository {
    return this.repository;
  }
}
