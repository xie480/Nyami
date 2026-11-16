import {
  BILIBILI_AUDIO_HOST_SUFFIXES,
  BILIBILI_TRUSTED_HOSTS,
} from '../constants';

/**
 * 校验 B 站受控页面地址。
 * 只允许 HTTPS 和固定主域名，避免 WebContentsView 被导航到任意站点。
 */
export function isTrustedBiliUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return BILIBILI_TRUSTED_HOSTS.some(
      host => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/**
 * 校验音频探测和请求头注入目标。
 * 音频 CDN 只按固定后缀匹配，防止主进程成为任意 URL 的 SSRF 代理。
 */
export function isAllowedBiliAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return BILIBILI_AUDIO_HOST_SUFFIXES.some(suffix =>
      hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

/**
 * 删除 URL 查询参数后返回可写入日志的地址，避免泄露签名和 Cookie。
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * 从 Cookie 字符串中提取 B 站 UID，只返回脱敏后的状态字段。
 */
export function extractBiliUid(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)DedeUserID=([0-9]+)/);
  return match?.[1] ?? null;
}

/**
 * 判断 Cookie 是否包含最小登录凭证集合。
 */
export function hasRequiredLoginCookies(cookie: string): boolean {
  return /(?:^|;\s*)SESSDATA=([^;]+)/.test(cookie);
}
