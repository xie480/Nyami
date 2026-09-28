import {useEffect, useMemo, useRef, useState} from 'react';
import {getAlbumPalette} from '../native/AlbumPaletteModule';
import {
  AlbumTheme,
  createAlbumTheme,
  interpolateAlbumTheme,
} from '../utils/albumTheme';

const THEME_TRANSITION_DURATION_MS = 420;

export function useAlbumTheme(
  artworkUri: string | undefined,
  fallbackAccent: string,
  shouldAnimate = true,
) {
  const fallback = useMemo(
    () => createAlbumTheme(null, fallbackAccent),
    [fallbackAccent],
  );
  const [theme, setTheme] = useState<AlbumTheme>(fallback);
  const currentTheme = useRef(theme);

  useEffect(() => {
    currentTheme.current = theme;
  }, [theme]);

  useEffect(() => {
    let isCurrentArtwork = true;
    let animationFrame: number | undefined;

    const updateTheme = (target: AlbumTheme) => {
      const from = currentTheme.current;
      const isSameTheme =
        from.primaryAccent === target.primaryAccent &&
        from.secondaryAccent === target.secondaryAccent &&
        from.foreground === target.foreground &&
        from.secondaryForeground === target.secondaryForeground &&
        from.playForeground === target.playForeground &&
        from.scrimOpacity === target.scrimOpacity &&
        from.effectiveBackgroundColor === target.effectiveBackgroundColor;
      if (!shouldAnimate || isSameTheme) {
        currentTheme.current = target;
        setTheme(target);
        return;
      }

      const startedAt = Date.now();
      const animate = () => {
        if (!isCurrentArtwork) {
          return;
        }
        const progress = Math.min(
          1,
          (Date.now() - startedAt) / THEME_TRANSITION_DURATION_MS,
        );
        const next = interpolateAlbumTheme(from, target, progress);
        currentTheme.current = next;
        setTheme(next);
        if (progress < 1) {
          animationFrame = requestAnimationFrame(animate);
        }
      };

      animationFrame = requestAnimationFrame(animate);
    };

    if (!artworkUri) {
      updateTheme(fallback);
    } else {
      getAlbumPalette(artworkUri).then(palette => {
        if (isCurrentArtwork) {
          updateTheme(createAlbumTheme(palette, fallbackAccent));
        }
      });
    }

    return () => {
      isCurrentArtwork = false;
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [artworkUri, fallback, fallbackAccent, shouldAnimate]);

  return theme;
}
