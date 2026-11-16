import md5 from 'md5';
import type {BiliWbiKeys} from '../types/bili';
import type {KeyValueStore, WbiSignerPort} from '../../../platform-contracts/src';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** 根据 Bilibili WBI 规则生成混合密钥。 */
function getMixinKey(original: string): string {
  return MIXIN_KEY_ENC_TAB
    .map(index => original[index])
    .join('')
    .slice(0, 32);
}

/** 生成带 wts 和 w_rid 的 WBI 查询字符串。 */
export function encWbi(
  params: Record<string, unknown>,
  imgKey: string,
  subKey: string,
  now = Date.now(),
): string {
  const mixinKey = getMixinKey(imgKey + subKey);
  const finalParams: Record<string, unknown> = {
    ...params,
    wts: Math.round(now / 1000),
  };
  const query = Object.keys(finalParams)
    .sort()
    .map(key => {
      const value = String(finalParams[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');

  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

type CachedWbiKeys = BiliWbiKeys & {fetchedAt: number};

/** 可注入 WBI 密钥来源的共享实现。 */
export class WbiSigner implements WbiSignerPort {
  private readonly cacheKey = 'wbiKeys';

  constructor(
    private readonly loadKeys: () => Promise<BiliWbiKeys>,
    private readonly store?: KeyValueStore,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 读取带 TTL 的 WBI 密钥。 */
  async getKeys(): Promise<BiliWbiKeys> {
    const cached = this.readCache();
    if (cached && this.now() - cached.fetchedAt < this.ttlMs) {
      return {
        imgKey: cached.imgKey,
        subKey: cached.subKey,
      };
    }

    const fresh = await this.loadKeys();
    this.store?.setString(
      this.cacheKey,
      JSON.stringify({
        ...fresh,
        fetchedAt: this.now(),
      }),
    );
    return fresh;
  }

  /** 使用当前密钥签名请求参数。 */
  async sign(params: Record<string, unknown>): Promise<string> {
    const keys = await this.getKeys();
    return encWbi(params, keys.imgKey, keys.subKey, this.now());
  }

  private readCache(): CachedWbiKeys | null {
    const raw = this.store?.getString(this.cacheKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<CachedWbiKeys>;
      if (
        typeof parsed.imgKey === 'string' &&
        typeof parsed.subKey === 'string' &&
        typeof parsed.fetchedAt === 'number'
      ) {
        return parsed as CachedWbiKeys;
      }
    } catch {
      return null;
    }

    return null;
  }
}
