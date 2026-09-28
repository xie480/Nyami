import type {AlbumPalette} from '../native/AlbumPaletteModule';

export interface AlbumTheme {
  primaryAccent: string;
  secondaryAccent: string;
  foreground: string;
  secondaryForeground: string;
  playForeground: string;
  scrimOpacity: number;
  effectiveBackgroundColor: string;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

const FALLBACK_BACKGROUND = '#171922';
const FALLBACK_ACCENT = '#F0C978';

function parseHex(value: string): RGB | null {
  const match = /^#?([\da-f]{6})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 16);
  return {
    r: Math.floor(parsed / 65536),
    g: Math.floor(parsed / 256) % 256,
    b: parsed % 256,
  };
}

function toHex({r, g, b}: RGB): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function relativeLuminance(color: RGB): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(color.r) +
    0.7152 * linear(color.g) +
    0.0722 * linear(color.b)
  );
}

function contrastRatio(first: RGB, second: RGB): number {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function blend(first: RGB, second: RGB, amount: number): RGB {
  return {
    r: first.r + (second.r - first.r) * amount,
    g: first.g + (second.g - first.g) * amount,
    b: first.b + (second.b - first.b) * amount,
  };
}

function toHsl({r, g, b}: RGB) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    switch (max) {
      case red:
        hue = ((green - blue) / delta) % 6;
        break;
      case green:
        hue = (blue - red) / delta + 2;
        break;
      default:
        hue = (red - green) / delta + 4;
        break;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }

  return {hue, saturation, lightness};
}

function fromHsl(hue: number, saturation: number, lightness: number): RGB {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let color: RGB;

  if (section < 1) {
    color = {r: chroma, g: x, b: 0};
  } else if (section < 2) {
    color = {r: x, g: chroma, b: 0};
  } else if (section < 3) {
    color = {r: 0, g: chroma, b: x};
  } else if (section < 4) {
    color = {r: 0, g: x, b: chroma};
  } else if (section < 5) {
    color = {r: x, g: 0, b: chroma};
  } else {
    color = {r: chroma, g: 0, b: x};
  }

  const offset = lightness - chroma / 2;
  return {
    r: (color.r + offset) * 255,
    g: (color.g + offset) * 255,
    b: (color.b + offset) * 255,
  };
}

function ensureContrast(
  hex: string,
  background: RGB,
  minimumRatio: number,
): string {
  const source = parseHex(hex) ?? parseHex(FALLBACK_ACCENT)!;
  if (contrastRatio(source, background) >= minimumRatio) {
    return toHex(source);
  }

  const target =
    relativeLuminance(background) < 0.45
      ? {r: 255, g: 255, b: 255}
      : {r: 0, g: 0, b: 0};
  for (let step = 1; step <= 20; step += 1) {
    const adjusted = blend(source, target, step / 20);
    if (contrastRatio(adjusted, background) >= minimumRatio) {
      return toHex(adjusted);
    }
  }
  return toHex(target);
}

function createDistinctSecondary(
  primaryHex: string,
  secondaryHex: string,
): string {
  const primary = parseHex(primaryHex) ?? parseHex(FALLBACK_ACCENT)!;
  const secondary = parseHex(secondaryHex) ?? primary;
  const distance = Math.hypot(
    primary.r - secondary.r,
    primary.g - secondary.g,
    primary.b - secondary.b,
  );
  if (distance >= 58) {
    return toHex(secondary);
  }

  const {hue, saturation, lightness} = toHsl(primary);
  return toHex(
    fromHsl(
      (hue + 34) % 360,
      Math.max(0.48, saturation),
      lightness > 0.56 ? 0.46 : 0.68,
    ),
  );
}

function chooseForeground(background: RGB): string {
  const light = parseHex('#FAF7F0')!;
  const dark = parseHex('#17191E')!;
  return contrastRatio(light, background) >= contrastRatio(dark, background)
    ? '#FAF7F0'
    : '#17191E';
}

function softenForeground(foreground: string, background: RGB): string {
  const source = parseHex(foreground)!;
  let result = source;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = blend(source, background, step / 20);
    if (contrastRatio(candidate, background) < 4.5) {
      break;
    }
    result = candidate;
  }
  return toHex(result);
}

function chooseForegroundForGradient(
  primary: string,
  secondary: string,
): string {
  const light = parseHex('#FAF7F0')!;
  const dark = parseHex('#17191E')!;
  const first = parseHex(primary)!;
  const second = parseHex(secondary)!;
  const lightContrast = Math.min(
    contrastRatio(light, first),
    contrastRatio(light, second),
  );
  const darkContrast = Math.min(
    contrastRatio(dark, first),
    contrastRatio(dark, second),
  );
  return lightContrast >= darkContrast ? '#FAF7F0' : '#17191E';
}

export function createAlbumTheme(
  palette: AlbumPalette | null,
  fallbackAccent = FALLBACK_ACCENT,
): AlbumTheme {
  const average =
    parseHex(palette?.average ?? '') ?? parseHex(FALLBACK_BACKGROUND)!;
  const rawLuminance = relativeLuminance(average);
  const scrimOpacity = Math.min(
    0.55,
    Math.max(0.28, 0.55 - rawLuminance * 0.27),
  );
  const effectiveBackground = blend(average, {r: 7, g: 9, b: 13}, scrimOpacity);
  const foreground = chooseForeground(effectiveBackground);

  const rawPrimary = palette?.primary ?? fallbackAccent;
  const rawSecondary = palette?.secondary ?? FALLBACK_ACCENT;
  const primaryAccent = ensureContrast(rawPrimary, effectiveBackground, 2.8);
  const distinctSecondary = createDistinctSecondary(
    primaryAccent,
    rawSecondary,
  );
  const secondaryAccent = ensureContrast(
    distinctSecondary,
    effectiveBackground,
    2.8,
  );
  return {
    primaryAccent,
    secondaryAccent,
    foreground,
    secondaryForeground: softenForeground(foreground, effectiveBackground),
    playForeground: chooseForegroundForGradient(primaryAccent, secondaryAccent),
    scrimOpacity,
    effectiveBackgroundColor: toHex(effectiveBackground),
  };
}

export function interpolateAlbumTheme(
  from: AlbumTheme,
  to: AlbumTheme,
  progress: number,
): AlbumTheme {
  const amount = Math.min(1, Math.max(0, progress));
  const effectiveBackground = blend(
    parseHex(from.effectiveBackgroundColor) ?? parseHex(FALLBACK_BACKGROUND)!,
    parseHex(to.effectiveBackgroundColor) ?? parseHex(FALLBACK_BACKGROUND)!,
    amount,
  );
  const primaryAccent = ensureContrast(
    toHex(
      blend(
        parseHex(from.primaryAccent) ?? parseHex(FALLBACK_ACCENT)!,
        parseHex(to.primaryAccent) ?? parseHex(FALLBACK_ACCENT)!,
        amount,
      ),
    ),
    effectiveBackground,
    2.8,
  );
  const secondaryCandidate = toHex(
    blend(
      parseHex(from.secondaryAccent) ?? parseHex(FALLBACK_ACCENT)!,
      parseHex(to.secondaryAccent) ?? parseHex(FALLBACK_ACCENT)!,
      amount,
    ),
  );
  const secondaryAccent = ensureContrast(
    createDistinctSecondary(primaryAccent, secondaryCandidate),
    effectiveBackground,
    2.8,
  );
  const foreground = chooseForeground(effectiveBackground);

  return {
    primaryAccent,
    secondaryAccent,
    foreground,
    secondaryForeground: softenForeground(foreground, effectiveBackground),
    playForeground: chooseForegroundForGradient(primaryAccent, secondaryAccent),
    scrimOpacity:
      from.scrimOpacity + (to.scrimOpacity - from.scrimOpacity) * amount,
    effectiveBackgroundColor: toHex(effectiveBackground),
  };
}
