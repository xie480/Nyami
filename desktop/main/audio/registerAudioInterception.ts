import {WebContents} from 'electron';
import {
  BILIBILI_REFERER,
  DESKTOP_USER_AGENT,
} from '../constants';
import {AudioRequestRecorder} from './audioRequestRecorder';
import {isAllowedBiliAudioUrl} from '../security/urlPolicy';

const AUDIO_REQUEST_FILTER = {
  urls: [
    'https://*.bilivideo.com/*',
    'https://*.mcdn.bilivideo.cn/*',
    'https://*.hdslb.com/*',
    'https://*.akamaized.net/*',
  ],
};

/**
 * 安装 Bilibili CDN 请求头注入和脱敏观察器。
 * @param targetSession 当前 BrowserWindow 使用的 Session
 * @param recorder 请求记录器
 */
export function registerAudioInterception(
  targetSession: Electron.Session,
  recorder: AudioRequestRecorder,
): void {
  targetSession.webRequest.onBeforeSendHeaders(
    AUDIO_REQUEST_FILTER,
    (details, callback) => {
      if (isAllowedBiliAudioUrl(details.url)) {
        details.requestHeaders.Referer = BILIBILI_REFERER;
        details.requestHeaders['User-Agent'] = DESKTOP_USER_AGENT;
        recorder.recordRequest(
          String(details.id),
          details.url,
          details.method,
          details.requestHeaders,
        );
      }
      callback({requestHeaders: details.requestHeaders});
    },
  );

  targetSession.webRequest.onHeadersReceived(
    AUDIO_REQUEST_FILTER,
    (details, callback) => {
      if (isAllowedBiliAudioUrl(details.url)) {
        recorder.recordResponse(
          String(details.id),
          details.statusCode,
          details.responseHeaders,
        );
      }
      callback({responseHeaders: details.responseHeaders});
    },
  );
}

/**
 * 清理窗口关闭后仍可能存在的音频 DOM 播放器引用。
 * 当前阶段仅保留签名，后续由播放器适配器接管。
 * @param contents Renderer webContents
 */
export function markAudioContentsReady(contents: WebContents): void {
  contents.setAudioMuted(false);
}
