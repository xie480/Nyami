/**
 * 阶段 0 使用的桌面端协议常量。
 * 认证协议与音频请求头集中管理，后续抽取共享核心时可直接复用。
 */

export const DESKTOP_APP_ID = 'com.nyami.desktop';

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const BILIBILI_REFERER = 'https://www.bilibili.com/';

export const BILIBILI_AUTH_ENDPOINTS = {
  qrGenerate:
    'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  qrPoll: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
  webHome: 'https://www.bilibili.com/',
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

export const AUDIO_REQUEST_LOG_LIMIT = 40;
