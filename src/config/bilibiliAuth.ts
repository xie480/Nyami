/**
 * B 站网页登录认证使用的端点、状态和协议常量。
 * 登录相关请求集中在此处，便于定位 B 站网页登录内部协议变化。
 */
export const BILIBILI_AUTH_ENDPOINTS = {
  qrGenerate:
    'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  qrPoll: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
  cookieInfo: 'https://passport.bilibili.com/x/passport-login/web/cookie/info',
  cookieRefresh:
    'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
  cookieRefreshConfirm:
    'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',
  webHome: 'https://www.bilibili.com/',
  webHomeOrigin: 'https://www.bilibili.com',
  passportOrigin: 'https://passport.bilibili.com',
  passwordLogin: 'https://passport.bilibili.com/login',
  correspondPrefix: 'https://www.bilibili.com/correspond/1/',
} as const;

export const BILIBILI_AUTH_TIMING = {
  qrLifetimeMs: 180000,
  qrPollIntervalMs: 2000,
  cookieWaitIntervalMs: 250,
  cookieWaitAttempts: 5,
  refreshTokenCaptureWaitMs: 900,
} as const;

export const BILIBILI_QR_STATUS = {
  expired: 86038,
  scanned: 86090,
  waiting: 86101,
} as const;

export const BILIBILI_API_STATUS = {
  success: 0,
  unauthenticated: -101,
} as const;

export const BILIBILI_WEBVIEW_MESSAGE = {
  cookieRefreshSuccess: 'cookie-refresh-success',
  cookieRefreshError: 'cookie-refresh-error',
  refreshToken: 'refresh-token',
} as const;

export const BILIBILI_QR_QUERY_PARAMETER = {
  key: 'qrcode_key',
  source: 'source',
} as const;

export const BILIBILI_COOKIE_QUERY_PARAMETER = {
  csrf: 'csrf',
} as const;

export const BILIBILI_COOKIE_REFRESH_PARAMETER = {
  csrf: 'csrf',
  refreshCsrf: 'refresh_csrf',
  source: 'source',
  refreshToken: 'refresh_token',
} as const;

export const BILIBILI_COOKIE_REFRESH_CONFIRM_PARAMETER = {
  csrf: 'csrf',
  refreshToken: 'refresh_token',
} as const;

export const BILIBILI_REFRESH_TOKEN_STORAGE_KEY = 'ac_time_value';
export const BILIBILI_QR_REQUEST_SOURCE = 'main-fe-header';
export const BILIBILI_COOKIE_REFRESH_SOURCE = 'main_web';
export const BILIBILI_REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
export const BILIBILI_REFRESH_TOKEN_CAPTURE_HOSTS = [
  'www.bilibili.com',
  'passport.bilibili.com',
] as const;
export const BILIBILI_COOKIE_NAMES = {
  sessdata: 'SESSDATA',
  csrf: 'bili_jct',
  uid: 'DedeUserID',
  uidChecksum: 'DedeUserID__ckMd5',
  sid: 'sid',
} as const;
export const BILIBILI_CSRF_COOKIE_NAME = BILIBILI_COOKIE_NAMES.csrf;
export const BILIBILI_REFRESH_CSRF_SELECTOR = '#1-name';

export const BILIBILI_AUTH_HOSTS = ['bilibili.com', 'biligame.com'] as const;
export const BILIBILI_MAIN_HOSTS = [
  'www.bilibili.com',
  'm.bilibili.com',
  'bilibili.com',
] as const;
export const BILIBILI_LOGIN_COOKIE_NAMES = [
  BILIBILI_COOKIE_NAMES.sessdata,
  BILIBILI_COOKIE_NAMES.csrf,
  BILIBILI_COOKIE_NAMES.uid,
  BILIBILI_COOKIE_NAMES.uidChecksum,
  BILIBILI_COOKIE_NAMES.sid,
] as const;

export const BILIBILI_REFRESH_PUBLIC_KEY = {
  kty: 'RSA',
  n: 'y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE',
  e: 'AQAB',
} as const;
