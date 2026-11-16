import {
  BILIBILI_AUTH_ENDPOINTS,
  BILIBILI_QR_SOURCE,
  BILIBILI_QR_STATUS,
  DESKTOP_USER_AGENT,
} from '../constants';

type BiliEnvelope<T> = {
  code: number;
  message?: string;
  data: T;
};

type QrCodeResponse = {
  url: string;
  qrcode_key: string;
};

export type QrPollResponse = {
  url: string;
  refresh_token?: string;
  code: number;
  message?: string;
};

/**
 * B 站二维码 API 客户端。
 * qrcode_key 只在主进程内部流转，不出现在 preload 或 Renderer IPC 契约中。
 */
export class QrClient {
  /**
   * 请求二维码地址和轮询密钥。
   * @returns 主进程内部使用的二维码数据
   */
  async generate(): Promise<QrCodeResponse> {
    const response = await this.request<BiliEnvelope<QrCodeResponse>>(
      BILIBILI_AUTH_ENDPOINTS.qrGenerate,
    );
    if (
      response.code !== 0 ||
      !response.data?.url ||
      !response.data?.qrcode_key
    ) {
      throw new Error('B 站暂时无法生成二维码，请稍后重试');
    }
    return response.data;
  }

  /**
   * 查询二维码状态。
   * @param qrcodeKey 主进程保存的一次性轮询密钥
   * @returns B 站二维码状态
   */
  async poll(qrcodeKey: string): Promise<QrPollResponse> {
    const url = new URL(BILIBILI_AUTH_ENDPOINTS.qrPoll);
    url.searchParams.set('qrcode_key', qrcodeKey);
    url.searchParams.set('source', BILIBILI_QR_SOURCE);
    return this.request<BiliEnvelope<QrPollResponse>>(url.toString()).then(
      response => {
        if (!response.data) {
          throw new Error('B 站暂时无法查询扫码状态');
        }
        return response.data;
      },
    );
  }

  /**
   * 将 B 站状态码映射为桌面端状态和提示。
   * @param code B 站二维码状态码
   * @returns UI 可展示的状态描述
   */
  describeStatus(code: number): {
    status: 'waiting' | 'scanned' | 'expired' | 'success' | 'error';
    message: string;
  } {
    if (code === BILIBILI_QR_STATUS.success) {
      return {status: 'success', message: '扫码成功，正在读取登录状态'};
    }
    if (code === BILIBILI_QR_STATUS.waiting) {
      return {status: 'waiting', message: '请使用 Bilibili 客户端扫码'};
    }
    if (code === BILIBILI_QR_STATUS.scanned) {
      return {status: 'scanned', message: '已扫码，请在手机上确认登录'};
    }
    if (code === BILIBILI_QR_STATUS.expired) {
      return {status: 'expired', message: '二维码已过期，请重新生成'};
    }
    return {status: 'error', message: '二维码登录失败，请重新生成'};
  }

  /**
   * 发起不携带 Cookie 的 B 站请求并解析 JSON。
   * @param url 请求地址
   * @returns JSON 响应
   */
  private async request<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          Referer: BILIBILI_AUTH_ENDPOINTS.webHome,
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('无法连接 B 站登录服务，请检查网络后重试');
    }

    if (!response.ok) {
      throw new Error(`B 站登录服务暂不可用（HTTP ${response.status}）`);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new Error('B 站登录服务返回了无效响应');
    }
  }
}
