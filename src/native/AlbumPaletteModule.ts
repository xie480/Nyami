import {NativeModules} from 'react-native';

export interface AlbumPalette {
  primary: string;
  secondary: string;
  average: string;
}

interface NativeAlbumPaletteModule {
  getColors(uri: string): Promise<AlbumPalette>;
}

const nativeAlbumPalette = NativeModules.AlbumPaletteModule as
  | NativeAlbumPaletteModule
  | undefined;

const paletteCache = new Map<string, Promise<AlbumPalette | null>>();
const MAX_PALETTE_CACHE_SIZE = 48;

/**
 * Extract one cached palette per cover URL. Native extraction happens only when
 * the active artwork changes; the player UI never performs pixel work per frame.
 */
export function getAlbumPalette(uri: string): Promise<AlbumPalette | null> {
  const normalizedUri = uri.trim();
  if (!normalizedUri || !nativeAlbumPalette?.getColors) {
    return Promise.resolve(null);
  }

  const cached = paletteCache.get(normalizedUri);
  if (cached) {
    paletteCache.delete(normalizedUri);
    paletteCache.set(normalizedUri, cached);
    return cached;
  }

  const request = Promise.resolve()
    .then(() => nativeAlbumPalette.getColors(normalizedUri))
    .then(colors => colors)
    .catch(() => {
      paletteCache.delete(normalizedUri);
      return null;
    });

  paletteCache.set(normalizedUri, request);
  if (paletteCache.size > MAX_PALETTE_CACHE_SIZE) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey) {
      paletteCache.delete(oldestKey);
    }
  }

  return request;
}
