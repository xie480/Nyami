import {app, net, protocol} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const LOCAL_AUDIO_SCHEME = 'nyami-local';

/**
 * 在 app ready 前注册安全的本地音频协议权限。
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
  ]);
}

/**
 * 注册阶段 0 的离线样例音频处理器。
 * 只暴露仓库内固定的 silence_10s.wav，不接受任意文件路径。
 */
export function registerLocalAudioHandler(): void {
  protocol.handle(LOCAL_AUDIO_SCHEME, request => {
    const url = new URL(request.url);
    if (url.hostname !== 'sample' || url.pathname !== '/silence_10s.wav') {
      return new Response('Not Found', {status: 404});
    }

    const source = app.isPackaged
      ? path.join(process.resourcesPath, 'resource', 'silence_10s.wav')
      : path.join(app.getAppPath(), 'resource', 'silence_10s.wav');
    return net.fetch(pathToFileURL(source).toString());
  });
}

/**
 * 返回给 Renderer 的离线样例地址。
 * @returns 不包含真实文件系统路径的应用协议 URL
 */
export function getSampleAudioUrl(): string {
  return `${LOCAL_AUDIO_SCHEME}://sample/silence_10s.wav`;
}
