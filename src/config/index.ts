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
    folderVideos: 5 * 60 * 1000,     // 收藏夹视频 5 分钟
    videoInfo: 24 * 60 * 60 * 1000,  // 视频元信息 1 天
    videoTags: 30 * 24 * 60 * 60 * 1000, // 视频 tag 30 天
    audioUrl: 60 * 60 * 1000,        // 音频 URL 1 小时（B 站约 2 小时失效）
  },

  /** 收藏 tag 画像与推荐参数 */
  tagRecommendations: {
    cacheQueryChunkSize: 500,
    maxProfileTags: 5,
    searchConcurrency: 5,
    backfillBatchSize: 64,
    backfillConcurrency: 16,
    backfillCacheWriteBatchSize: 16,
    maxRecommendations: 30,
    musicTid: 3,
    transientRetryDelayMs: 30 * 60 * 1000,
    unavailableRetryDelayMs: 24 * 60 * 60 * 1000,
  },

  /** 全局索引同步参数；列表间并行，单个列表仍按页顺序续传。 */
  favoriteSync: {
    playlistConcurrency: 3,
  },

  /** 首页推荐和搜索的产品边界值。 */
  recommendations: {
    homeRefreshIntervalMs: 5 * 60 * 60 * 1000,
    recommendationHistoryTtlMs: 7 * 24 * 60 * 60 * 1000,
    defaultDurationLimitMinutes: 5,
    maxDurationLimitMinutes: 1440,
    maxBlacklistKeywords: 100,
    maxBlacklistKeywordLength: 64,
    homeMinimumRecommendationCount: 5,
    homeMinimumSongSearchPages: 3,
    homePlaylistPreviewCount: 5,
    homePlaylistLimit: 20,
    homeSongPreviewCount: 5,
  },

  /** 播放器淡入淡出过渡参数。 */
  playback: {
    fadeInDurationMs: 200,
    fadeOutDurationMs: 150,
    fadeOutLeadMs: 180,
    fadeStepCount: 4,
    hydratedTrackCacheTtlMs: 30 * 1000,
    hydratedTrackCacheLimit: 16,
    progressUpdateIntervalSeconds: 0.25,
  },

  /** HTTP 请求超时 */
  httpTimeout: 60000,

  /** 速率限制：自适应上限每秒 3 次请求；服务端限流时自动降速。 */
  rateLimit: {
    perSecond: 3,
    burstSize: 2,
  },

  /** 重试次数（不含首次请求） */
  retry: {
    maxAttempts: 6,
    delayMs: 2000,
    totalTimeoutMs: 180000, // 单次 API 请求及全部重试的最长耗时：3 分钟
  },
};
