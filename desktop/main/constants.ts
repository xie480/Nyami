/**
 * 阶段 0 使用的桌面端协议常量。
 * 认证协议与音频请求头集中管理，后续抽取共享核心时可直接复用。
 */

import {config} from '../../packages/core/src/config';

export const DESKTOP_APP_ID = 'com.nyami.desktop';

/** 保持既有 Windows userData 目录名，避免产品名大小写变更导致数据迁移。 */
export const DESKTOP_USER_DATA_DIRECTORY_NAME = 'Nyami';

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const BILIBILI_REFERER = 'https://www.bilibili.com/';

export const BILIBILI_AUTH_ENDPOINTS = {
  qrGenerate:
    'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  qrPoll: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
  webHome: 'https://www.bilibili.com/',
  passwordLogin: 'https://passport.bilibili.com/login',
  cookieInfo:
    'https://passport.bilibili.com/x/passport-login/web/cookie/info',
  cookieRefresh:
    'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
  cookieRefreshConfirm:
    'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',
  correspondPrefix: 'https://www.bilibili.com/correspond/1/',
} as const;

export const BILIBILI_QR_STATUS = {
  expired: 86038,
  scanned: 86090,
  waiting: 86101,
  success: 0,
} as const;

export const BILIBILI_QR_SOURCE = 'main-fe-header';
export const BILIBILI_QR_LIFETIME_MS = 180000;
export const BILIBILI_QR_POLL_INTERVAL_MS = 2000;

export const BILIBILI_COOKIE_REFRESH_SOURCE = 'main_web';
export const BILIBILI_REFRESH_CSRF_ID = '1-name';
export const BILIBILI_REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
export const BILIBILI_REFRESH_PUBLIC_KEY = {
  kty: 'RSA',
  n: 'y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE',
  e: 'AQAB',
} as const;

export const BILIBILI_LOGIN_COOKIE_NAMES = new Set([
  'SESSDATA',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'bili_jct',
  'sid',
]);

export const BILIBILI_REQUIRED_LOGIN_COOKIE_NAMES = [
  'SESSDATA',
  'DedeUserID',
  'bili_jct',
] as const;

export const BILIBILI_TRUSTED_HOSTS = [
  'bilibili.com',
  'biligame.com',
] as const;

export const BILIBILI_AUDIO_HOST_SUFFIXES = [
  '.bilivideo.com',
  '.mcdn.bilivideo.cn',
  '.hdslb.com',
  '.akamaized.net',
] as const;

export const BILIBILI_IMAGE_HOST_SUFFIXES = [
  '.hdslb.com',
  '.bilibili.com',
] as const;

export const AUDIO_REQUEST_LOG_LIMIT = 40;

/** PC 端收藏夹同步只串行处理一个来源，避免多个来源同时触发 B 站限流。 */
export const DESKTOP_SYNC_PLAYLIST_CONCURRENCY = 1;

/** PC 端单个收藏夹按页顺序拉取，与 Android 端的断点和增量语义一致。 */
export const DESKTOP_SYNC_PAGE_CONCURRENCY = 1;

/** PC 端索引请求的自适应限流上限，与 Android 端共享核心配置一致。 */
export const DESKTOP_INDEX_RATE_LIMIT = config.rateLimit.perSecond;

/** PC 端索引请求启动时允许的令牌突发数，与 Android 端一致。 */
export const DESKTOP_INDEX_RATE_BURST = config.rateLimit.burstSize;
