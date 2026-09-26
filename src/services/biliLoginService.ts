/**
 * B 站网页登录认证 API 适配器。
 * 负责生成/轮询网页二维码和检查 Cookie 是否需要按 B 站流程续期；
 * 不保存凭证，也不将二维码或令牌发送给第三方服务。
 */
import axios from 'axios';
import {config} from '../config';
import {
  BILIBILI_API_STATUS,
  BILIBILI_AUTH_ENDPOINTS,
  BILIBILI_CSRF_COOKIE_NAME,
  BILIBILI_COOKIE_QUERY_PARAMETER,
  BILIBILI_QR_QUERY_PARAMETER,
  BILIBILI_QR_REQUEST_SOURCE,
} from '../config/bilibiliAuth';
import {AuthRequiredError} from '../core/errors';

const LOGIN_HEADERS = {
  'User-Agent': config.userAgent,
  Referer: BILIBILI_AUTH_ENDPOINTS.webHome,
};

type BiliEnvelope<T> = {
  code: number;
  message?: string;
  data: T;
};

export type QrCodeData = {
  url: string;
  qrcode_key: string;
};

export type QrPollData = {
  url: string;
  refresh_token: string;
  code: number;
  message?: string;
};

export type CookieRefreshInfo = {
  refresh: boolean;
  timestamp: number;
};

export const biliLoginService = {
  /** 申请网页登录二维码；异常时返回不含原始响应内容的可读错误。 */
  async generateQrCode(): Promise<QrCodeData> {
    const response = await axios.get<BiliEnvelope<QrCodeData>>(
      BILIBILI_AUTH_ENDPOINTS.qrGenerate,
      {headers: LOGIN_HEADERS, timeout: 15000},
    );
    if (
      response.data.code !== BILIBILI_API_STATUS.success ||
      !response.data.data?.url ||
      !response.data.data?.qrcode_key
    ) {
      throw new Error('B 站暂时无法生成二维码，请稍后重试');
    }
    return response.data.data;
  },

  /** 查询二维码状态；二维码密钥仅通过本地请求参数传递。 */
  async pollQrCode(qrcodeKey: string): Promise<QrPollData> {
    const response = await axios.get<BiliEnvelope<QrPollData>>(
      BILIBILI_AUTH_ENDPOINTS.qrPoll,
      {
        params: {
          [BILIBILI_QR_QUERY_PARAMETER.key]: qrcodeKey,
          [BILIBILI_QR_QUERY_PARAMETER.source]: BILIBILI_QR_REQUEST_SOURCE,
        },
        headers: LOGIN_HEADERS,
        timeout: 15000,
      },
    );
    if (!response.data.data) {
      throw new Error('B 站暂时无法查询扫码状态');
    }
    return response.data.data;
  },

  /** 检查网页登录 Cookie 的续期状态；只在返回 refresh=true 时交由 WebView 续期。 */
  async getCookieRefreshInfo(cookie: string): Promise<CookieRefreshInfo> {
    const csrf = cookie.match(
      new RegExp(`(?:^|;\\s*)${BILIBILI_CSRF_COOKIE_NAME}=([^;]+)`),
    )?.[1];
    const response = await axios.get<BiliEnvelope<CookieRefreshInfo>>(
      BILIBILI_AUTH_ENDPOINTS.cookieInfo,
      {
        params: csrf
          ? {[BILIBILI_COOKIE_QUERY_PARAMETER.csrf]: csrf}
          : undefined,
        headers: {...LOGIN_HEADERS, Cookie: cookie},
        timeout: 15000,
      },
    );
    if (response.data.code === BILIBILI_API_STATUS.unauthenticated) {
      throw new AuthRequiredError('B 站登录会话已失效');
    }
    if (
      response.data.code !== BILIBILI_API_STATUS.success ||
      !response.data.data
    ) {
      throw new Error('检查 B 站登录状态失败');
    }
    if (
      typeof response.data.data.refresh !== 'boolean' ||
      !Number.isFinite(response.data.data.timestamp) ||
      response.data.data.timestamp <= 0
    ) {
      throw new Error('B 站返回了无效的登录状态');
    }
    return response.data.data;
  },
};
