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
  getFavoriteFolders(upMid: string) {
    return biliGet<FolderListResp>('/x/v3/fav/folder/created/list-all', {
      params: { up_mid: upMid },
    });
  },

  getFavoriteVideos(mediaId: string | number, pn = 1, ps = 20) {
    return biliGet<FavoriteListResp>('/x/v3/fav/resource/list', {
      params: { media_id: mediaId, pn, ps, platform: 'web', order: 'mtime' },
    });
  },

  getVideoInfo(bvid: string) {
    return biliGet<BiliVideoInfo>('/x/web-interface/view', {
      params: { bvid },
    });
  },

  async getPlayUrl(bvid: string, cid: number) {
    const { imgKey, subKey } = await getWbiKeys();
    const query = encWbi(
      { bvid, cid, fnval: 16, fnver: 0, fourk: 1 },
      imgKey,
      subKey
    );
    return biliGet<BiliPlayUrlData>(`/x/player/wbi/playurl?${query}`);
  },
};
