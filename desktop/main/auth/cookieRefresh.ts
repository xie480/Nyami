import {
  BILIBILI_AUTH_ENDPOINTS,
  BILIBILI_COOKIE_REFRESH_SOURCE,
  BILIBILI_REFRESH_CSRF_ID,
  BILIBILI_REFRESH_PUBLIC_KEY,
  BILIBILI_REFRESH_TOKEN_PATTERN,
  BILIBILI_REFERER,
  DESKTOP_USER_AGENT,
} from '../constants';

type BiliEnvelope<T> = {
  code: number;
  message?: string;
  data: T;
};

type CookieRefreshInfo = {
  refresh: boolean;
  timestamp: number;
};

type CookieRefreshResult = {
  ok: boolean;
  refreshToken?: string;
};

/**
 * Bilibili Cookie 续期协议适配器。
 * 检查请求在主进程执行，RSA 和 Cookie 续期脚本只注入受控 Bilibili 页面。
 */
export class CookieRefreshService {
  /** 查询当前 Cookie 是否进入 B 站要求的续期窗口。 */
  async getRefreshInfo(cookie: string): Promise<CookieRefreshInfo> {
    const csrf = readCookie(cookie, 'bili_jct');
    const url = new URL(BILIBILI_AUTH_ENDPOINTS.cookieInfo);
    if (csrf) {
      url.searchParams.set('csrf', csrf);
    }
    const response = await fetch(url, {
      headers: {
        'User-Agent': DESKTOP_USER_AGENT,
        Referer: BILIBILI_REFERER,
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`B 站登录状态检查失败（HTTP ${response.status}）`);
    }
    const payload = (await response.json()) as BiliEnvelope<CookieRefreshInfo>;
    if (payload.code === -101) {
      throw new Error('B 站登录会话已失效，请重新登录');
    }
    if (
      payload.code !== 0 ||
      !payload.data ||
      typeof payload.data.refresh !== 'boolean' ||
      !Number.isFinite(payload.data.timestamp) ||
      payload.data.timestamp <= 0
    ) {
      throw new Error('B 站返回了无效的登录续期状态');
    }
    return payload.data;
  }

  /** 构造只会在受控 Bilibili 页面执行的续期脚本。 */
  buildScript(refreshToken: string, timestamp: number): string {
    if (
      !BILIBILI_REFRESH_TOKEN_PATTERN.test(refreshToken) ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      throw new Error('B 站续期参数无效');
    }
    const input = JSON.stringify({refreshToken, timestamp});
    const protocol = JSON.stringify({
      publicKey: BILIBILI_REFRESH_PUBLIC_KEY,
      correspondPrefix: BILIBILI_AUTH_ENDPOINTS.correspondPrefix,
      cookieRefresh: BILIBILI_AUTH_ENDPOINTS.cookieRefresh,
      cookieRefreshConfirm: BILIBILI_AUTH_ENDPOINTS.cookieRefreshConfirm,
      refreshSource: BILIBILI_COOKIE_REFRESH_SOURCE,
      refreshCsrfId: BILIBILI_REFRESH_CSRF_ID,
    });
    return `
(async function () {
  var input = ${input};
  var protocol = ${protocol};
  var readCookie = function (name) {
    var prefix = name + '=';
    var item = document.cookie.split(';').map(function (part) {
      return part.trim();
    }).find(function (part) {
      return part.indexOf(prefix) === 0;
    });
    return item ? item.slice(prefix.length) : '';
  };
  try {
    var publicKey = await window.crypto.subtle.importKey(
      'jwk',
      protocol.publicKey,
      {name: 'RSA-OAEP', hash: 'SHA-256'},
      false,
      ['encrypt']
    );
    var encrypted = await window.crypto.subtle.encrypt(
      {name: 'RSA-OAEP'},
      publicKey,
      new TextEncoder().encode('refresh_' + input.timestamp)
    );
    var correspondPath = Array.from(new Uint8Array(encrypted)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
    var correspondResponse = await fetch(
      protocol.correspondPrefix + correspondPath,
      {credentials: 'include'}
    );
    if (!correspondResponse.ok) {
      throw new Error('correspond');
    }
    var correspondHtml = await correspondResponse.text();
    var correspondDoc = new DOMParser().parseFromString(correspondHtml, 'text/html');
    var refreshCsrfElement = correspondDoc.getElementById(protocol.refreshCsrfId);
    var refreshCsrf = refreshCsrfElement ? refreshCsrfElement.textContent : '';
    var csrf = readCookie('bili_jct');
    if (!refreshCsrf || !csrf) {
      throw new Error('csrf');
    }
    var refreshResponse = await fetch(protocol.cookieRefresh, {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body: new URLSearchParams({
        csrf: csrf,
        refresh_csrf: refreshCsrf.trim(),
        source: protocol.refreshSource,
        refresh_token: input.refreshToken
      }).toString()
    });
    var refreshResult = await refreshResponse.json();
    if (
      !refreshResponse.ok ||
      refreshResult.code !== 0 ||
      !refreshResult.data ||
      typeof refreshResult.data.refresh_token !== 'string'
    ) {
      throw new Error('refresh');
    }
    var newCsrf = readCookie('bili_jct');
    if (!newCsrf) {
      throw new Error('new-csrf');
    }
    var confirmResponse = await fetch(protocol.cookieRefreshConfirm, {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body: new URLSearchParams({
        csrf: newCsrf,
        refresh_token: input.refreshToken
      }).toString()
    });
    var confirmResult = await confirmResponse.json();
    if (!confirmResponse.ok || confirmResult.code !== 0) {
      throw new Error('confirm');
    }
    return {
      ok: true,
      refreshToken: refreshResult.data.refresh_token
    };
  } catch (error) {
    return {ok: false};
  }
})();
`;
  }
}

/** 从 Cookie 头中读取指定字段。 */
function readCookie(cookie: string, name: string): string | null {
  return cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? null;
}

