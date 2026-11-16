import {
  BILIBILI_REFERER,
  DESKTOP_USER_AGENT,
} from '../constants';
import {isAllowedBiliAudioUrl, redactUrl} from '../security/urlPolicy';
import type {
  AudioProbeAttempt,
  AudioProbeRequest,
  AudioProbeResult,
} from '../../shared/types';

/**
 * 用于阶段 0 的 B 站音频探测器。
 * 通过 Range 请求确认 CDN 能力，并在 URL 过期时用调用方提供的新 URL 重试。
 */
export class AudioProbe {
  /**
   * 探测音频 URL、响应头和过期重取路径。
   * @param request 远程 URL 与可选重取 URL
   * @returns 不含响应体的探测结果
   */
  async inspect(request: AudioProbeRequest): Promise<AudioProbeResult> {
    const firstUrl = this.normalizeUrl(request.url);
    const retryUrl = request.retryUrl
      ? this.normalizeUrl(request.retryUrl)
      : null;
    const attempts: AudioProbeAttempt[] = [];

    const first = await this.inspectOnce(firstUrl);
    attempts.push(first);
    const shouldRetry =
      retryUrl &&
      retryUrl !== firstUrl &&
      [401, 403, 404, 410, 416].includes(first.status ?? 0);
    if (!shouldRetry) {
      return this.toResult(attempts, firstUrl, false);
    }

    const second = await this.inspectOnce(retryUrl);
    attempts.push(second);
    return this.toResult(attempts, retryUrl, true);
  }

  /**
   * 验证并规范化 B 站音频 URL。
   * @param value 外部输入 URL
   * @returns 规范化后的 URL
   */
  private normalizeUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || !isAllowedBiliAudioUrl(trimmed)) {
      throw new Error('只允许探测 B 站音频 CDN 地址');
    }
    return trimmed;
  }

  /**
   * 发起一次不读取正文的 Range 请求。
   * @param url 音频 URL
   * @returns 脱敏后的单次请求结果
   */
  private async inspectOnce(url: string): Promise<AudioProbeAttempt> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          Referer: BILIBILI_REFERER,
          Range: 'bytes=0-1',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      return {
        url: redactUrl(url),
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        contentRange: response.headers.get('content-range'),
        acceptRanges: response.headers.get('accept-ranges'),
        error: null,
      };
    } catch (error) {
      return {
        url: redactUrl(url),
        status: null,
        statusText: '',
        contentType: null,
        contentLength: null,
        contentRange: null,
        acceptRanges: null,
        error: error instanceof Error ? error.message : '网络请求失败',
      };
    }
  }

  /**
   * 汇总单次或两次探测结果。
   */
  private toResult(
    attempts: AudioProbeAttempt[],
    finalUrl: string,
    retried: boolean,
  ): AudioProbeResult {
    const finalAttempt = attempts[attempts.length - 1];
    const rangeSupported =
      finalAttempt.status === 206 ||
      Boolean(finalAttempt.contentRange) ||
      finalAttempt.acceptRanges?.toLowerCase() === 'bytes';
    return {
      ok: Boolean(finalAttempt.status && finalAttempt.status >= 200 && finalAttempt.status < 300),
      finalUrl: finalAttempt.status ? redactUrl(finalUrl) : null,
      rangeSupported,
      retried,
      attempts,
    };
  }
}
