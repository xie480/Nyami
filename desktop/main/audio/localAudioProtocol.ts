import {app, net, protocol} from 'electron';
import {createReadStream, promises as fs} from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import type {AudioCacheStore} from '../runtime/audioCacheStore';

const LOCAL_AUDIO_SCHEME = 'nyami-local';
const CACHE_AUDIO_SCHEME = 'nyami-cache';
let cacheAudioHandlerRegistered = false;

/**
 * 在 app ready 前注册安全的本地音频协议权限。
 * 不接收参数，不返回值。
 */
export function registerLocalAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_AUDIO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
    {
      scheme: CACHE_AUDIO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * 注册阶段 0 的离线样例音频处理器。
 * 只暴露仓库内固定的 silence_10s.wav，不接受任意文件路径。
 * 不接收参数，不返回值。
 */
export function registerLocalAudioHandler(): void {
  protocol.handle(LOCAL_AUDIO_SCHEME, async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'sample' || url.pathname !== '/silence_10s.wav') {
      return new Response('Not Found', {status: 404});
    }

    const source = app.isPackaged
      ? path.join(process.resourcesPath, 'resource', 'silence_10s.wav')
      : path.join(app.getAppPath(), 'resource', 'silence_10s.wav');
    const response = await net.fetch(pathToFileURL(source).toString());
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    );
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  });
}

/**
 * 注册受控缓存协议，并保留 Range 响应以支持拖动进度。
 * @param cacheStore 音频缓存索引
 */
export function registerAudioCacheHandler(cacheStore: AudioCacheStore): void {
  if (cacheAudioHandlerRegistered) {
    return;
  }
  cacheAudioHandlerRegistered = true;
  protocol.handle(CACHE_AUDIO_SCHEME, async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'audio') {
      return new Response('Not Found', {status: 404});
    }
    let key: string;
    try {
      key = decodeURIComponent(url.pathname.replace(/^\//, ''));
    } catch {
      return new Response('Not Found', {status: 404});
    }
    const entry = await cacheStore.resolveByKey(key);
    if (!entry) {
      return new Response('Not Found', {status: 404});
    }
    try {
      const stat = await fs.stat(entry.path);
      const range = parseRange(request.headers.get('range'), stat.size);
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stat.size - 1);
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Accept-Ranges, Content-Length, Content-Range, Content-Type',
        'Cache-Control': 'no-store',
        'Content-Length': String(Math.max(0, end - start + 1)),
        'Content-Type': entry.mimeType,
      });
      if (range) {
        headers.set(
          'Content-Range',
          `bytes ${start}-${end}/${stat.size}`,
        );
      }
      if (request.method === 'HEAD') {
        return new Response(null, {
          headers,
          status: range ? 206 : 200,
        });
      }
      const stream = createReadStream(
        entry.path,
        {
          start,
          end,
        },
      );
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
        headers,
        status: range ? 206 : 200,
      });
    } catch {
      return new Response('Not Found', {status: 404});
    }
  });
}

/**
 * 返回给 Renderer 的离线样例地址。
 * @returns 不包含真实文件系统路径的应用协议 URL
 */
export function getSampleAudioUrl(): string {
  return `${LOCAL_AUDIO_SCHEME}://sample/silence_10s.wav`;
}

/**
 * 生成缓存音频地址。
 * @param key 缓存索引键
 * @returns 不包含真实文件系统路径的应用协议 URL
 */
export function getCachedAudioUrl(key: string): string {
  return `${CACHE_AUDIO_SCHEME}://audio/${encodeURIComponent(key)}`;
}

/** 解析单段 bytes Range，非法 Range 返回 null 并回退整文件响应。 */
function parseRange(
  value: string | null,
  size: number,
): {start: number; end: number} | null {
  if (!value || size <= 0) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const startValue = match[1] ? Number(match[1]) : null;
  const endValue = match[2] ? Number(match[2]) : null;
  if (startValue === null && endValue === null) {
    return null;
  }
  const start =
    startValue === null
      ? Math.max(0, size - Math.min(endValue ?? 0, size))
      : startValue;
  const end = Math.min(
    size - 1,
    startValue === null ? size - 1 : endValue === null ? size - 1 : endValue,
  );
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return {start, end};
}
