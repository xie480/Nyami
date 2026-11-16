import type {CredentialSnapshot} from '../../../platform-contracts/src';

/** Bilibili Cookie 中共享业务需要的字段。 */
export type BiliCookieParts = {
  sessdata: string | null;
  uid: string | null;
  csrf: string | null;
};

/** 从 Cookie 字符串读取指定字段，避免平台层重复实现解析规则。 */
export function readCookieValue(
  cookie: string,
  name: string,
): string | null {
  const pattern = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  return cookie.match(pattern)?.[1] ?? null;
}

/** 解析 Bilibili 登录和收藏写入所需的 Cookie 字段。 */
export function parseBiliCookie(cookie: string): BiliCookieParts {
  return {
    sessdata: readCookieValue(cookie, 'SESSDATA'),
    uid: readCookieValue(cookie, 'DedeUserID'),
    csrf: readCookieValue(cookie, 'bili_jct'),
  };
}

/** 将平台凭证快照转换为 Cookie 文本，保持核心不接触安全存储实现。 */
export function cookieFromCredentials(
  credentials: CredentialSnapshot,
): string {
  return credentials.cookie.trim();
}

