export const config = {
  /** B 站 API 基础地址 */
  biliBaseURL: 'https://api.bilibili.com',

  /** 请求 User-Agent（统一使用 PC Chrome，避免 B 站强制返回 MP4 导致无 dash 音频流）*/
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  /** 请求 Referer（B 站接口必需）*/
  referer: 'https://www.bilibili.com/',

  /** 缓存 TTL，单位毫秒 */
  cacheTTL: {
    wbiKeys: 60 * 60 * 1000,         // WBI 密钥 1 小时
    folders: 10 * 60 * 1000,         // 收藏夹列表 10 分钟
    folderVideos: 5 * 60 * 1000,     // 收藏夹视频 5 分钟
    videoInfo: 24 * 60 * 60 * 1000,  // 视频元信息 1 天
    audioUrl: 60 * 60 * 1000,        // 音频 URL 1 小时（B 站约 2 小时失效）
  },

  /** HTTP 请求超时 */
  httpTimeout: 60000,

  /** 速率限制：每秒最多 1 次请求 */
  rateLimit: {
    perSecond: 1,
    burstSize: 2,
  },

  /** 重试次数 */
  retry: {
    maxAttempts: 6,
    delayMs: 2000,
  },
};
