export { favoriteService } from './favoriteService';
export { audioService } from './audioService';
export { cookieService } from './cookieService';

// 错误类型也对外暴露，UI 可针对性处理
export {
  BiliError,
  NetworkError,
  BiliApiError,
  AuthRequiredError,
  ResourceUnavailableError,
  RateLimitError,
} from '../core/errors';

// 配置常量（UI 层会用到 referer/userAgent 设置 TrackPlayer headers）
export { config as bizConfig } from '../config';
