import {Model} from '@nozbe/watermelondb';
import {field} from '@nozbe/watermelondb/decorators';

export class RecommendationFilter extends Model {
  static table = 'recommendation_filter';

  @field('uid') uid!: string;
  @field('item_type') itemType!: string;
  @field('item_id') itemId!: string;
  @field('title_key') titleKey!: string | null;
  @field('expires_at') expiresAt!: number;
}
