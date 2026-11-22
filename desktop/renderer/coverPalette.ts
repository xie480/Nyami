/**
 * 封面取色工具：在渲染器中低频读取封面缩略图，并生成适合沉浸式背景的三种柔和主色。
 */

export type CoverPalette = {
  primary: string;
  secondary: string;
  tertiary: string;
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type HslColor = {
  h: number;
  s: number;
  l: number;
};

type ColorBucket = RgbColor & {
  count: number;
};

const SAMPLE_SIZE = 24;
const COLOR_BIN_SIZE = 32;
const MIN_COLOR_DISTANCE = 42;
const COVER_LOAD_TIMEOUT_MS = 3500;

export const DEFAULT_COVER_PALETTE: CoverPalette = {
  primary: 'rgb(227, 198, 183)',
  secondary: 'rgb(183, 201, 211)',
  tertiary: 'rgb(117, 78, 87)',
};

/** 从封面地址提取三种柔和主色，读取失败时返回稳定的 NYAMI 默认色。 */
export async function extractCoverPalette(
  coverUrl: string,
): Promise<CoverPalette> {
  if (!coverUrl) {
    return DEFAULT_COVER_PALETTE;
  }

  try {
    const image = await loadCoverImage(coverUrl);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!context) {
      return DEFAULT_COVER_PALETTE;
    }

    context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    return buildCoverPalette(pixels);
  } catch {
    return DEFAULT_COVER_PALETTE;
  }
}

/** 加载单张封面并限制等待时间，避免网络图片阻塞播放页渲染。 */
function loadCoverImage(coverUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      image.src = '';
      reject(new Error('封面读取超时'));
    }, COVER_LOAD_TIMEOUT_MS);

    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(image);
    };
    image.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      reject(new Error('封面读取失败'));
    };
    image.src = coverUrl;
  });
}

/** 对缩略图做轻量量化，过滤极端黑白色后挑选彼此有区分度的候选色。 */
function buildCoverPalette(pixels: Uint8ClampedArray): CoverPalette {
  const buckets = new Map<string, ColorBucket>();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 96) {
      continue;
    }

    const color = {
      r: pixels[index] ?? 0,
      g: pixels[index + 1] ?? 0,
      b: pixels[index + 2] ?? 0,
    };
    const key = [
      quantizeChannel(color.r),
      quantizeChannel(color.g),
      quantizeChannel(color.b),
    ].join(':');
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += color.r;
      bucket.g += color.g;
      bucket.b += color.b;
      bucket.count += 1;
      continue;
    }
    buckets.set(key, {
      ...color,
      count: 1,
    });
  }

  const candidates = [...buckets.values()]
    .map(bucket => {
      const color = {
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
      };
      const saturation = getSaturation(color);
      const brightness = getBrightness(color);
      const edgePenalty = brightness > 0.96 || brightness < 0.06 ? 0.42 : 1;
      return {
        color,
        score: bucket.count * (0.72 + saturation * 0.92) * edgePenalty,
      };
    })
    .sort((left, right) => right.score - left.score);

  const selected: RgbColor[] = [];
  for (const candidate of candidates) {
    if (
      selected.every(
        selectedColor =>
          colorDistance(selectedColor, candidate.color) >= MIN_COLOR_DISTANCE,
      )
    ) {
      selected.push(candidate.color);
    }
    if (selected.length === 3) {
      break;
    }
  }

  for (const candidate of candidates) {
    if (selected.length === 3) {
      break;
    }
    selected.push(candidate.color);
  }

  while (selected.length < 3) {
    selected.push({
      r: 227,
      g: 198,
      b: 183,
    });
  }

  return {
    primary: softenColor(selected[0]),
    secondary: softenColor(selected[1]),
    tertiary: softenColor(selected[2]),
  };
}

/** 将通道压入有限色阶，减少单个像素噪声对主色的影响。 */
function quantizeChannel(channel: number): number {
  return Math.round(channel / COLOR_BIN_SIZE);
}

/** 读取 RGB 颜色的亮度，避免纯黑或纯白背景占据全部候选。 */
function getBrightness(color: RgbColor): number {
  return (color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) / 255;
}

/** 读取 RGB 颜色的相对饱和度，用于降低灰白色的大面积权重。 */
function getSaturation(color: RgbColor): number {
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  if (maximum === 0) {
    return 0;
  }
  return (maximum - minimum) / maximum;
}

/** 使用欧氏距离判断两种 RGB 颜色是否过于接近。 */
function colorDistance(left: RgbColor, right: RgbColor): number {
  return Math.sqrt(
    (left.r - right.r) ** 2 +
      (left.g - right.g) ** 2 +
      (left.b - right.b) ** 2,
  );
}

/** 限制饱和度与明度，使主色融入玻璃背景后仍然柔和通透。 */
function softenColor(color: RgbColor): string {
  const hsl = rgbToHsl(color);
  const softened = {
    h: hsl.h,
    s: clamp(hsl.s * 0.68, 0.12, 0.58),
    l: clamp(hsl.l * 0.92 + 0.04, 0.3, 0.78),
  };
  const rgb = hslToRgb(softened);
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(
    rgb.b,
  )})`;
}

/** 将 RGB 转换为 HSL，便于统一控制取色后的饱和度与明度。 */
function rgbToHsl(color: RgbColor): HslColor {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (maximum === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }

  const lightness = (maximum + minimum) / 2;
  const saturation =
    delta === 0
      ? 0
      : delta / (1 - Math.abs(2 * lightness - 1));

  return {
    h: hue,
    s: saturation,
    l: lightness,
  };
}

/** 将 HSL 转回 RGB，生成可直接写入 CSS 的颜色值。 */
function hslToRgb(color: HslColor): RgbColor {
  const chroma = (1 - Math.abs(2 * color.l - 1)) * color.s;
  const section = color.h / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  const match = color.l - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (section < 1) {
    red = chroma;
    green = intermediate;
  } else if (section < 2) {
    red = intermediate;
    green = chroma;
  } else if (section < 3) {
    green = chroma;
    blue = intermediate;
  } else if (section < 4) {
    green = intermediate;
    blue = chroma;
  } else if (section < 5) {
    red = intermediate;
    blue = chroma;
  } else {
    red = chroma;
    blue = intermediate;
  }

  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
}

/** 将数值限制在指定范围内，避免 CSS 背景出现极端颜色。 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
