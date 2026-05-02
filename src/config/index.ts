export const config = {
  /** B 站 API 基础地址 */
  biliBaseURL: 'https://api.bilibili.com',

  /** 请求 User-Agent（统一使用移动端 Safari）*/
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',

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
  httpTimeout: 12000,

  /** 速率限制：每秒最多 2 次请求 */
  rateLimit: {
    perSecond: 2,
    burstSize: 4,
  },

  /** 重试次数 */
  retry: {
    maxAttempts: 2,
    delayMs: 800,
  },
};
