import {
  BILIBILI_AUDIO_HOST_SUFFIXES,
  BILIBILI_REQUIRED_LOGIN_COOKIE_NAMES,
  BILIBILI_TRUSTED_HOSTS,
} from '../constants';

/**
 * 校验 B 站受控页面地址。
 * 只允许 HTTPS 和固定主域名，避免 WebContentsView 被导航到任意站点。
 * @param value 待校验的页面地址
 * @returns 是否属于可信 B 站 HTTPS 地址
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
 * @param value 待校验的音频地址
 * @returns 是否属于允许的 B 站音频 CDN 地址
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
 * @param value 原始 URL
 * @returns 只包含 origin 和 pathname 的脱敏 URL
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
 * @param cookie 主进程内部的 Cookie 字符串
 * @returns B 站 UID；未找到时返回 null
 */
export function extractBiliUid(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)DedeUserID=([0-9]+)/);
  return match?.[1] ?? null;
}

/**
 * 判断 Cookie 是否包含最小登录凭证集合。
 * @param cookie 主进程内部的 Cookie 字符串
 * @returns 是否同时包含 SESSDATA、DedeUserID 和 bili_jct
 */
export function hasRequiredLoginCookies(cookie: string): boolean {
  return BILIBILI_REQUIRED_LOGIN_COOKIE_NAMES.every(name =>
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).test(cookie),
  );
}
