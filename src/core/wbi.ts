import axios from 'axios';
import {encWbi as sharedEncWbi} from '../../packages/core/src/api/wbi';
import {config} from '../config';
import {storage} from './storage';
import {cookieService} from '../services/cookieService';
import type {BiliWbiKeys} from '../types/bili';

/** 共享纯函数的移动端兼容出口。 */
export const encWbi = sharedEncWbi;

type CachedKeys = BiliWbiKeys & {fetchedAt: number};

/** 获取带本地 TTL 缓存的 WBI 密钥，保持移动端历史存储格式。 */
export async function getWbiKeys(): Promise<BiliWbiKeys> {
  const cached = storage.getJSON<CachedKeys>('wbiKeys');
  if (cached && Date.now() - cached.fetchedAt < config.cacheTTL.wbiKeys) {
    return {imgKey: cached.imgKey, subKey: cached.subKey};
  }

  const cookie = await cookieService.get();
  const {data} = await axios.get(`${config.biliBaseURL}/x/web-interface/nav`, {
    headers: {
      'User-Agent': config.userAgent,
      Referer: config.referer,
      Cookie: cookie || '',
    },
    timeout: config.httpTimeout,
  });
  const imgUrl: string = data?.data?.wbi_img?.img_url || '';
  const subUrl: string = data?.data?.wbi_img?.sub_url || '';
  if (!imgUrl || !subUrl) {
    throw new Error('获取 WBI 密钥失败');
  }
  const imgKey = imgUrl.slice(
    imgUrl.lastIndexOf('/') + 1,
    imgUrl.lastIndexOf('.'),
  );
  const subKey = subUrl.slice(
    subUrl.lastIndexOf('/') + 1,
    subUrl.lastIndexOf('.'),
  );
  storage.setJSON('wbiKeys', {imgKey, subKey, fetchedAt: Date.now()});
  return {imgKey, subKey};
}
