import {biliGet, biliPost} from '../core/http';
import {encWbi, getWbiKeys} from '../core/wbi';
import type {RequestPriority} from '../core/adaptiveRateLimit';
import {cookieService} from './cookieService';
import type {
  BiliFolder,
  BiliCollectedPlaylistList,
  BiliSeasonArchivesPage,
  BiliFavoriteVideoMedia,
  BiliVideoSearchPage,
  BiliVideoInfo,
  BiliVideoTag,
  BiliPlayUrlData,
} from '../types/bili';

const VIDEO_TAGS_ENDPOINT = '/x/tag/archive/tags';

interface FolderListResp {
  count: number;
  list: BiliFolder[];
}

interface FavoriteListResp {
  info: {id: number; title: string; media_count: number; intro?: string};
  medias: BiliFavoriteVideoMedia[];
  has_more: boolean;
}

function encodeForm(values: Record<string, string | number>) {
  return Object.entries(values)
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value)).replace(/%20/g, '+')}`,
    )
    .join('&');
}

async function getWriteCredentials(expectedUid: string) {
  if (!expectedUid) {
    throw new Error('当前账号未登录，无法修改 B 站收藏');
  }
  const cookie = await cookieService.get();
  if (
    !cookieService.extractSessdata(cookie) ||
    cookieService.extractUid(cookie) !== expectedUid
  ) {
    throw new Error('B 站登录账号已变化，请刷新页面后重试');
  }
  const csrf = cookieService.extractCsrf(cookie);
  if (!csrf) {
    throw new Error('登录 Cookie 缺少 bili_jct，请重新登录后重试');
  }
  return {cookie, csrf};
}

export const biliApi = {
  /** 获取用户全部收藏夹（后台静默请求，鉴权失败时不唤起 Webview 登录弹窗） */
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
    return biliGet<FolderListResp>('/x/v3/fav/folder/created/list-all', {
      params,
      signal,
      silent: true,
      rateLimitPriority,
    });
  },

  /** 写操作前复核 Cookie 归属与 CSRF 是否仍属于当前账号。 */
  async assertWriteAccount(expectedUid: string) {
    await getWriteCredentials(expectedUid);
  },

  /** B 站网页端视频搜索；每页 20 条，响应数据包含标题与 tag。 */
  async searchVideos(keyword: string, page = 1, signal?: AbortSignal, tids = 0) {
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
    const {imgKey, subKey} = await getWbiKeys();
    const signedQuery = encWbi(
      {
        search_type: 'video',
        keyword: normalizedKeyword,
        order: 'totalrank',
        duration: 0,
        tids,
        page,
      },
      imgKey,
      subKey,
    );
    return biliGet<BiliVideoSearchPage>(
      `/x/web-interface/wbi/search/type?${signedQuery}`,
      {signal, silent: true},
      1,
    );
  },

  /** 获取单个视频的 tag；使用轻量接口，避免详情聚合接口附带 Related 数据。 */
  async getVideoTags(bvid: string, signal?: AbortSignal) {
    const normalizedBvid = bvid.trim();
    if (!normalizedBvid) {
      throw new Error('bvid 不能为空');
    }
    const tags = await biliGet<BiliVideoTag[]>(
      VIDEO_TAGS_ENDPOINT,
      {
        params: {bvid: normalizedBvid},
        signal,
        silent: true,
        rateLimitPriority: 'background',
      },
      1,
    );
    if (!Array.isArray(tags)) {
      throw new Error('B 站视频 tag 响应格式无效');
    }
    return tags;
  },

  /** 新建自有收藏夹；明确绑定当前账号 Cookie 与 CSRF。 */
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
    return biliPost<BiliFolder>(
      '/x/v3/fav/folder/add',
      encodeForm({title: normalizedTitle, intro: '', privacy, csrf}),
      {headers: {Cookie: cookie}},
    );
  },

  /** 将单个视频写入一个或多个自有收藏夹。 */
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
    return biliPost<unknown>(
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

  /** 获取当前账号收藏的他人收藏夹及视频合集目录（B 站网页端接口）。 */
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
    return biliGet<BiliCollectedPlaylistList>(
      '/x/v3/fav/folder/collected/list',
      {
        params: {up_mid: upMid, pn, ps, platform: 'web'},
        signal,
        silent: true,
        rateLimitPriority,
      },
    );
  },

  /** 获取收藏夹内视频（分页，后台静默请求） */
  getFavoriteVideos(
    mediaId: string | number,
    pn = 1,
    ps = 20,
    signal?: AbortSignal,
    rateLimitPriority: RequestPriority = 'normal',
  ) {
    if (!mediaId) {
      return Promise.reject(new Error('mediaId 不能为空'));
    }
    // B 站收藏夹资源列表需要 WBI 签名 (wts + w_rid)
    // 使用最新的 WBI 密钥对请求参数进行签名后拼接到 URL，避免 axios 再次编码 params
    return (async () => {
      const {imgKey, subKey} = await getWbiKeys();
      const signedQuery = encWbi(
        {media_id: mediaId, pn, ps, platform: 'web', order: 'mtime'},
        imgKey,
        subKey,
      );
      // 将签名后的查询字符串直接拼接到路径上
      return biliGet<FavoriteListResp>(
        `/x/v3/fav/resource/list?${signedQuery}`,
        {
          signal,
          silent: true,
          rateLimitPriority,
        },
      );
    })();
  },

  /** 获取指定 UP 主合集内的视频（B 站网页端接口）。 */
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
    return biliGet<BiliSeasonArchivesPage>(
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

  /** 获取视频元信息（含 cid） */
  getVideoInfo(bvid: string) {
    if (!bvid) {
      return Promise.reject(new Error('bvid 不能为空'));
    }
    return biliGet<BiliVideoInfo>('/x/web-interface/view', {
      params: {bvid},
    });
  },

  /** 获取播放地址（DASH，含独立音频流，需 WBI 签名） */
  async getPlayUrl(bvid: string, cid: number) {
    if (!bvid || cid == null) {
      throw new Error('bvid 和 cid 不能为空');
    }
    const {imgKey, subKey} = await getWbiKeys();
    const query = encWbi(
      {bvid, cid, fnval: 16, fnver: 0, fourk: 1},
      imgKey,
      subKey,
    );
    return biliGet<BiliPlayUrlData>(`/x/player/wbi/playurl?${query}`);
  },

  /** 获取登录用户信息（包含 UID、用户名、头像、大会员状态） */
  async getUserInfo(silent = false) {
    const data = await biliGet<any>('/x/web-interface/nav', {silent});
    if (!data) {
      throw new Error('获取用户信息失败');
    }
    const uid = data?.mid ? String(data.mid) : '';
    const name = data?.uname ?? '';
    const avatar = data?.face ?? '';
    const vipStatus = {
      type: data?.vip_type ?? 0,
      status: data?.vip_status ?? 0,
      dueDate: data?.vip_due_date
        ? Math.floor(data.vip_due_date / 1000)
        : undefined,
    };
    return {uid, name, avatar, vipStatus};
  },
};
