import axios from 'axios';
import {WbiSigner, encWbi as sharedEncWbi} from '../../packages/core/src/api/wbi';
import {config} from '../config';
import {storage} from './storage';
import {cookieService} from '../services/cookieService';
import type {BiliWbiKeys} from '../types/bili';

/** 移动端 WBI 适配器，保留原有缓存和 Cookie 读取入口。 */
const signer = new WbiSigner(
  async (): Promise<BiliWbiKeys> => {
    const cookie = await cookieService.get();
    const {data} = await axios.get(
      `${config.biliBaseURL}/x/web-interface/nav`,
      {
        headers: {
          'User-Agent': config.userAgent,
          Referer: config.referer,
          Cookie: cookie || '',
        },
        timeout: config.httpTimeout,
      },
    );
    const imgUrl: string = data?.data?.wbi_img?.img_url || '';
    const subUrl: string = data?.data?.wbi_img?.sub_url || '';
    if (!imgUrl || !subUrl) {
      throw new Error('获取 WBI 密钥失败');
    }
    return {
      imgKey: imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.')),
      subKey: subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.')),
    };
  },
  {
    getString: key => storage.getString(key) ?? null,
    setString: (key, value) => storage.setString(key, value),
    delete: key => storage.delete(key),
    contains: key => storage.getString(key) !== undefined,
  },
  config.cacheTTL.wbiKeys,
);

/** 共享纯函数的移动端兼容出口。 */
export const encWbi = sharedEncWbi;

/** 获取带本地 TTL 缓存的 WBI 密钥。 */
export async function getWbiKeys(): Promise<BiliWbiKeys> {
  return signer.getKeys();
}
