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
    videoTags: 30 * 24 * 60 * 60 * 1000, // 视频 tag 30 天
    audioUrl: 60 * 60 * 1000,        // 音频 URL 1 小时（B 站约 2 小时失效）
  },

  /** 收藏 tag 画像与推荐参数 */
  tagRecommendations: {
    cacheQueryChunkSize: 500,
    maxProfileTags: 5,
    maxRecommendations: 30,
    musicTid: 3,
    transientRetryDelayMs: 30 * 60 * 1000,
    unavailableRetryDelayMs: 24 * 60 * 60 * 1000,
  },

  /** 首页推荐和搜索的产品边界值。 */
  recommendations: {
    homeRefreshIntervalMs: 5 * 60 * 60 * 1000,
    recommendationHistoryTtlMs: 7 * 24 * 60 * 60 * 1000,
    defaultDurationLimitMinutes: 5,
    maxDurationLimitMinutes: 1440,
    maxBlacklistKeywords: 100,
    maxBlacklistKeywordLength: 64,
    homePlaylistPreviewCount: 4,
    homePlaylistLimit: 20,
    homeSongPreviewCount: 4,
  },

  /** 播放器淡入淡出过渡参数。 */
  playback: {
    fadeInDurationMs: 300,
    fadeOutDurationMs: 240,
    fadeOutLeadMs: 700,
    fadeStepCount: 8,
    progressUpdateIntervalSeconds: 0.25,
  },

  /** HTTP 请求超时 */
  httpTimeout: 60000,

  /** 速率限制：每秒最多 1 次请求 */
  rateLimit: {
    perSecond: 1,
    burstSize: 2,
  },

  /** 重试次数（不含首次请求） */
  retry: {
    maxAttempts: 6,
    delayMs: 2000,
    totalTimeoutMs: 180000, // 单次 API 请求及全部重试的最长耗时：3 分钟
  },
};
