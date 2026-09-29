import type {BiliFavoriteVideoMedia} from '../types/bili';

export function findFirstValidFavoriteCover(
  medias: readonly Pick<BiliFavoriteVideoMedia, 'attr' | 'cover'>[],
): string | null {
  return (
    medias.find(media => media.attr === 0 && media.cover.trim().length > 0)
      ?.cover ?? null
  );
}
