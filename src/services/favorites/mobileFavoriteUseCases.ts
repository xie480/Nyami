import {
  FavoriteSyncTask,
  FavoriteUseCases,
} from '../../../packages/core/src/favorites';
import {biliApi} from '../biliApi';
import {mobileFavoriteRepository} from '../../platform/mobile/favoriteRepository';

/** 移动端共享收藏用例组合根，供页面和后续桌面端迁移复用。 */
export const mobileFavoriteUseCases = new FavoriteUseCases(
  biliApi,
  mobileFavoriteRepository,
  new FavoriteSyncTask(mobileFavoriteRepository),
);
