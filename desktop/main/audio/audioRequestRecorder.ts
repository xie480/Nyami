import {AUDIO_REQUEST_LOG_LIMIT} from '../constants';
import {redactUrl} from '../security/urlPolicy';
import type {AudioRequestRecord} from '../../shared/types';

type PendingRequest = AudioRequestRecord;

/**
 * 记录 Chromium 音频请求的脱敏摘要。
 * 不保存完整 URL 查询参数、Cookie、Referer 或 User-Agent。
 */
export class AudioRequestRecorder {
  private readonly records: PendingRequest[] = [];

  /**
   * 记录请求发送阶段的 Range 信息。
   * @param requestId Electron 请求标识
   * @param url 原始音频 URL
   * @param method HTTP 方法
   * @param headers 请求头
   */
  recordRequest(
    requestId: string,
    url: string,
    method: string,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    const range = this.readHeader(headers, 'range');
    const record: PendingRequest = {
      requestId,
      host: parsed.hostname,
      pathname: parsed.pathname,
      method,
      range,
      status: null,
      contentRange: null,
      contentType: null,
      timestamp: Date.now(),
    };
    this.records.push(record);
    this.trim();
  }

  /**
   * 记录响应状态与 Range 能力。
   * @param requestId Electron 请求标识
   * @param statusCode HTTP 状态码
   * @param headers 响应头
   */
  recordResponse(
    requestId: string,
    statusCode: number,
    headers: Record<string, string[] | undefined> | undefined,
  ): void {
    const record = this.records.find(item => item.requestId === requestId);
    if (!record) {
      return;
    }
    record.status = statusCode;
    record.contentRange = this.readHeader(headers ?? {}, 'content-range');
    record.contentType = this.readHeader(headers ?? {}, 'content-type');
  }

  /**
   * 返回最近的脱敏请求摘要。
   * @returns 按时间倒序排列的请求记录
   */
  list(): AudioRequestRecord[] {
    return [...this.records].reverse();
  }

  /**
   * 清空探测记录。
   */
  clear(): void {
    this.records.length = 0;
  }

  /**
   * 将不安全的请求地址转换为日志可用的路径。
   * @param url 原始 URL
   * @returns 不带查询参数的地址
   */
  static redact(url: string): string {
    return redactUrl(url);
  }

  /**
   * 读取大小写不敏感的 HTTP Header。
   * @param headers HTTP 头集合
   * @param name 待读取的头名称
   * @returns 头值；不存在时返回 null
   */
  private readHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const key = Object.keys(headers).find(
      candidate => candidate.toLowerCase() === name,
    );
    const value = key ? headers[key] : undefined;
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  }

  /**
   * 限制内存中请求摘要数量。
   * 不返回值；只保留最近的固定数量记录。
   */
  private trim(): void {
    if (this.records.length > AUDIO_REQUEST_LOG_LIMIT) {
      this.records.splice(0, this.records.length - AUDIO_REQUEST_LOG_LIMIT);
    }
  }
}
