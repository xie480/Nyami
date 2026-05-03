import { biliGet } from '../core/http';
import { encWbi, getWbiKeys } from '../core/wbi';
import type {
  BiliFolder,
  BiliFavoriteVideoMedia,
  BiliVideoInfo,
  BiliPlayUrlData,
} from '../types/bili';

interface FolderListResp {
  count: number;
  list: BiliFolder[];
}

interface FavoriteListResp {
  info: { id: number; title: string; media_count: number };
  medias: BiliFavoriteVideoMedia[];
  has_more: boolean;
}

export const biliApi = {
  /** 获取用户全部收藏夹 */
  getFavoriteFolders(upMid: string, signal?: AbortSignal) {
    if (!upMid) {
      return Promise.reject(new Error('upMid 不能为空'));
    }
    return biliGet<FolderListResp>('/x/v3/fav/folder/created/list-all', {
      params: { up_mid: upMid },
      signal,
    });
  },

  /** 获取收藏夹内视频（分页） */
  getFavoriteVideos(mediaId: string | number, pn = 1, ps = 20, signal?: AbortSignal) {
    if (!mediaId) {
      return Promise.reject(new Error('mediaId 不能为空'));
    }
    return biliGet<FavoriteListResp>('/x/v3/fav/resource/list', {
      params: { media_id: mediaId, pn, ps, platform: 'web', order: 'mtime' },
      signal,
    });
  },

  /** 获取视频元信息（含 cid） */
  getVideoInfo(bvid: string) {
    if (!bvid) {
      return Promise.reject(new Error('bvid 不能为空'));
    }
    return biliGet<BiliVideoInfo>('/x/web-interface/view', {
      params: { bvid },
    });
  },
  
  /** 获取播放地址（DASH，含独立音频流，需 WBI 签名） */
  async getPlayUrl(bvid: string, cid: number) {
    if (!bvid || cid == null) {
      throw new Error('bvid 和 cid 不能为空');
    }
    const { imgKey, subKey } = await getWbiKeys();
    const query = encWbi(
      { bvid, cid, fnval: 4048, fnver: 0, fourk: 1, platform: 'html5' },
      imgKey,
      subKey
    );
    return biliGet<BiliPlayUrlData>(`/x/player/wbi/playurl?${query}`);
  },
};
