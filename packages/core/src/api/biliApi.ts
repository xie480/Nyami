import type {
  BiliHttpPort,
  BiliHttpRequestOptions,
  CredentialStore,
  RequestPriority,
  WbiSignerPort,
} from '../../../platform-contracts/src';
import {parseBiliCookie} from '../auth/cookie';
import type {
  BiliCollectedPlaylistList,
  BiliFavoriteVideoMedia,
  BiliFolder,
  BiliPopularVideoPage,
  BiliPlayUrlData,
  BiliSeasonArchivesPage,
  BiliVideoInfo,
  BiliVideoSearchPage,
  BiliVideoTag,
} from '../types/bili';

const VIDEO_TAGS_ENDPOINT = '/x/tag/archive/tags';

type FolderListResponse = {
  count: number;
  list: BiliFolder[];
};

type FavoriteListResponse = {
  info: {
    id: number;
    title: string;
    media_count: number;
    intro?: string;
  };
  medias: BiliFavoriteVideoMedia[];
  has_more: boolean;
};

type BiliApiDependencies = {
  http: BiliHttpPort;
  wbi: WbiSignerPort;
  credentials: CredentialStore;
  validateWriteCredentials?: (
    expectedUid: string,
  ) => Promise<{cookie: string; csrf: string}>;
};

export type BiliApi = ReturnType<typeof createBiliApi>;

/** 创建不含平台依赖的 Bilibili API 用例集合。 */
export function createBiliApi(dependencies: BiliApiDependencies) {
  const encodeForm = (values: Record<string, string | number>) =>
    Object.entries(values)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value)).replace(/%20/g, '+')}`,
      )
      .join('&');

  const getWriteCredentials = async (expectedUid: string) => {
    if (dependencies.validateWriteCredentials) {
      return dependencies.validateWriteCredentials(expectedUid);
    }
    if (!expectedUid) {
      throw new Error('当前账号未登录，无法修改 B 站收藏');
    }

    const credentials = await dependencies.credentials.getCredentials();
    const cookie = credentials.cookie.trim();
    const parts = parseBiliCookie(cookie);
    if (!parts.sessdata || parts.uid !== expectedUid) {
      throw new Error('B 站登录账号已变化，请刷新页面后重试');
    }
    if (!parts.csrf) {
      throw new Error('登录 Cookie 缺少 bili_jct，请重新登录后重试');
    }
    return {cookie, csrf: parts.csrf};
  };

  const get = <T>(
    url: string,
    options: BiliHttpRequestOptions = {},
    retries?: number,
  ) => dependencies.http.get<T>(url, options, retries);

  return {
    /** 获取当前账号自有收藏夹。 */
    getFavoriteFolders(
      upMid: string,
      signal?: AbortSignal,
      rid?: number,
      rateLimitPriority: RequestPriority = 'normal',
    ) {
      if (!upMid) {
        return Promise.reject(new Error('upMid 不能为空'));
      }
      const params: Record<string, string | number> = {up_mid: upMid};
      if (rid !== undefined) {
        params.type = 2;
        params.rid = rid;
      }
      return get<FolderListResponse>('/x/v3/fav/folder/created/list-all', {
        params,
        signal,
        silent: true,
        rateLimitPriority,
      });
    },

    /** 在写收藏前校验当前 Cookie 的账号和 CSRF。 */
    async assertWriteAccount(expectedUid: string): Promise<void> {
      await getWriteCredentials(expectedUid);
    },

    /** 搜索 Bilibili 视频，参数签名在共享核心内完成。 */
    async searchVideos(
      keyword: string,
      page = 1,
      signal?: AbortSignal,
      tids = 0,
    ) {
      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) {
        throw new Error('搜索关键词不能为空');
      }
      if (!Number.isInteger(page) || page < 1) {
        throw new Error('搜索页码无效');
      }
      if (!Number.isSafeInteger(tids) || tids < 0) {
        throw new Error('视频分区 ID 无效');
      }
      const signedQuery = await dependencies.wbi.sign({
        search_type: 'video',
        keyword: normalizedKeyword,
        order: 'totalrank',
        duration: 0,
        tids,
        page,
      });
      return get<BiliVideoSearchPage>(
        `/x/web-interface/wbi/search/type?${signedQuery}`,
        {signal, silent: true},
        1,
      );
    },

    /** 获取 B 站热门视频，供桌面首页和发现页展示公开内容。 */
    getPopularVideos(
      page = 1,
      pageSize = 20,
      signal?: AbortSignal,
    ) {
      if (!Number.isInteger(page) || page < 1) {
        return Promise.reject(new Error('热门视频页码无效'));
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
        return Promise.reject(new Error('热门视频分页大小无效'));
      }
      return get<BiliPopularVideoPage>('/x/web-interface/popular', {
        params: {
          pn: page,
          ps: pageSize,
        },
        signal,
        silent: true,
      });
    },

    /** 获取单个视频的标签。 */
    async getVideoTags(bvid: string, signal?: AbortSignal) {
      const normalizedBvid = bvid.trim();
      if (!normalizedBvid) {
        throw new Error('bvid 不能为空');
      }
      const tags = await get<BiliVideoTag[]>(VIDEO_TAGS_ENDPOINT, {
        params: {bvid: normalizedBvid},
        signal,
        silent: true,
        rateLimitPriority: 'background',
      }, 1);
      if (!Array.isArray(tags)) {
        throw new Error('B 站视频 tag 响应格式无效');
      }
      return tags;
    },

    /** 新建自有收藏夹。 */
    async createFavoriteFolder(
      expectedUid: string,
      title: string,
      privacy: 0 | 1,
    ) {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        throw new Error('收藏夹名称不能为空');
      }
      const {cookie, csrf} = await getWriteCredentials(expectedUid);
      return dependencies.http.post<BiliFolder>(
        '/x/v3/fav/folder/add',
        encodeForm({title: normalizedTitle, intro: '', privacy, csrf}),
        {headers: {Cookie: cookie}},
      );
    },

    /** 将视频加入一个或多个自有收藏夹。 */
    async addVideoToFavoriteFolders(
      expectedUid: string,
      aid: number,
      folderIds: number[],
    ) {
      if (!Number.isSafeInteger(aid) || aid <= 0) {
        throw new Error('视频 AID 无效，无法收藏');
      }
      const uniqueFolderIds = [...new Set(folderIds)];
      if (
        uniqueFolderIds.length === 0 ||
        uniqueFolderIds.some(id => !Number.isSafeInteger(id) || id <= 0)
      ) {
        throw new Error('请选择有效的自有收藏夹');
      }
      const {cookie, csrf} = await getWriteCredentials(expectedUid);
      return dependencies.http.post<unknown>(
        '/x/v3/fav/resource/deal',
        encodeForm({
          rid: aid,
          type: 2,
          add_media_ids: uniqueFolderIds.join(','),
          del_media_ids: '',
          csrf,
        }),
        {headers: {Cookie: cookie}},
      );
    },

    /** 从自有收藏夹取消视频收藏。 */
    async removeVideoFromFavoriteFolder(
      expectedUid: string,
      aid: number,
      folderId: number,
    ) {
      if (!Number.isSafeInteger(aid) || aid <= 0) {
        throw new Error('视频 AID 无效，无法取消收藏');
      }
      if (!Number.isSafeInteger(folderId) || folderId <= 0) {
        throw new Error('收藏夹 ID 无效，无法取消收藏');
      }
      const {cookie, csrf} = await getWriteCredentials(expectedUid);
      return dependencies.http.post<unknown>(
        '/x/v3/fav/resource/deal',
        encodeForm({
          rid: aid,
          type: 2,
          add_media_ids: '',
          del_media_ids: String(folderId),
          csrf,
        }),
        {headers: {Cookie: cookie}},
      );
    },

    /** 获取已收藏的外部收藏夹和合集目录。 */
    getCollectedPlaylists(
      upMid: string,
      pn = 1,
      ps = 50,
      signal?: AbortSignal,
      rateLimitPriority: RequestPriority = 'normal',
    ) {
      if (!upMid) {
        return Promise.reject(new Error('upMid 不能为空'));
      }
      return get<BiliCollectedPlaylistList>(
        '/x/v3/fav/folder/collected/list',
        {
          params: {up_mid: upMid, pn, ps, platform: 'web'},
          signal,
          silent: true,
          rateLimitPriority,
        },
      );
    },

    /** 分页获取收藏夹视频。 */
    async getFavoriteVideos(
      mediaId: string | number,
      pn = 1,
      ps = 20,
      signal?: AbortSignal,
      rateLimitPriority: RequestPriority = 'normal',
    ) {
      if (!mediaId) {
        throw new Error('mediaId 不能为空');
      }
      const signedQuery = await dependencies.wbi.sign({
        media_id: mediaId,
        pn,
        ps,
        platform: 'web',
        order: 'mtime',
      });
      return get<FavoriteListResponse>(
        `/x/v3/fav/resource/list?${signedQuery}`,
        {signal, silent: true, rateLimitPriority},
      );
    },

    /** 获取指定 UP 主合集的视频。 */
    getSeasonArchives(
      mid: number,
      seasonId: number,
      pageNum = 1,
      pageSize = 20,
      signal?: AbortSignal,
      rateLimitPriority: RequestPriority = 'normal',
    ) {
      if (!mid || !seasonId) {
        return Promise.reject(new Error('UP 主 UID 和合集 ID 不能为空'));
      }
      return get<BiliSeasonArchivesPage>(
        '/x/polymer/web-space/seasons_archives_list',
        {
          params: {
            mid,
            season_id: seasonId,
            sort_reverse: false,
            page_num: pageNum,
            page_size: pageSize,
          },
          signal,
          silent: true,
          rateLimitPriority,
        },
      );
    },

    /** 获取视频详情（包括 CID 和多 P 信息）。 */
    getVideoInfo(bvid: string) {
      if (!bvid) {
        return Promise.reject(new Error('bvid 不能为空'));
      }
      return get<BiliVideoInfo>('/x/web-interface/view', {
        params: {bvid},
      });
    },

    /** 获取 DASH 音频播放地址。 */
    async getPlayUrl(bvid: string, cid: number) {
      if (!bvid || cid == null) {
        throw new Error('bvid 和 cid 不能为空');
      }
      const query = await dependencies.wbi.sign({
        bvid,
        cid,
        fnval: 16,
        fnver: 0,
        fourk: 1,
      });
      return get<BiliPlayUrlData>(`/x/player/wbi/playurl?${query}`);
    },

    /** 获取登录用户的脱敏资料。 */
    async getUserInfo(silent = false) {
      const data = await get<{
        mid?: number;
        uname?: string;
        face?: string;
        vip_type?: number;
        vip_status?: number;
        vip_due_date?: number;
      }>('/x/web-interface/nav', {silent});
      if (!data) {
        throw new Error('获取用户信息失败');
      }
      return {
        uid: data.mid ? String(data.mid) : '',
        name: data.uname ?? '',
        avatar: data.face ?? '',
        vipStatus: {
          type: data.vip_type ?? 0,
          status: data.vip_status ?? 0,
          dueDate: data.vip_due_date
            ? Math.floor(data.vip_due_date / 1000)
            : undefined,
        },
      };
    },
  };
}
