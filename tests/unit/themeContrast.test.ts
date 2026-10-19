import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import renderer, {act} from 'react-test-renderer';
import {lightColors, darkColors} from '../../src/theme/colors';
import {ThemeProvider, useTheme} from '../../src/theme/ThemeProvider';
import type {Theme} from '../../src/theme/ThemeProvider';

let mockThemeMode = 'glass-light';

jest.mock('react-native', () => ({useColorScheme: () => 'light'}));
jest.mock('../../src/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: {themeMode: string}) => unknown) =>
    selector({themeMode: mockThemeMode}),
}));

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  if (!/^#[a-f\d]{6}$/i.test(hex)) {
    throw new Error(`Expected an opaque RGB color, received ${hex}`);
  }
  return [1, 3, 5].map(offset =>
    parseInt(hex.slice(offset, offset + 2), 16),
  ) as RGB;
}

function composite(color: string, backdrop: RGB): RGB {
  if (color.startsWith('#')) {
    return rgb(color);
  }
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length !== 4) {
    throw new Error(`Unsupported color ${color}`);
  }
  return backdrop.map(
    (value, index) => channels[index] * channels[3] + value * (1 - channels[3]),
  ) as RGB;
}

function luminance(channels: RGB) {
  const linear = channels.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground: string, background: RGB) {
  const front = luminance(rgb(foreground));
  const back = luminance(background);
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

const surfaces = [
  'background',
  'surface',
  'surfaceHigh',
  'surfaceRaised',
] as const;
const textRoles = ['text', 'textSub', 'textHint', 'primary'] as const;
const statusRoles = ['error', 'success', 'warning'] as const;

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as Array<[string, typeof lightColors]>)('%s theme contrast', (_name, colors) => {
  it.each(textRoles)('keeps %s readable on every standard surface', role => {
    for (const surface of surfaces) {
      const ratio = contrast(colors[role], rgb(colors[surface]));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps primary button labels readable on their background', () => {
    expect(
      contrast(colors.onPrimary, rgb(colors.primary)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(statusRoles)(
    'keeps %s status text and filled-control labels readable',
    role => {
      for (const surface of surfaces) {
        expect(
          contrast(colors[role], rgb(colors[surface])),
        ).toBeGreaterThanOrEqual(4.5);
      }
      const onRole = `on${role[0].toUpperCase()}${role.slice(1)}` as
        | 'onError'
        | 'onSuccess'
        | 'onWarning';
      expect(
        contrast(colors[onRole], rgb(colors[role])),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe.each(['glass-light', 'glass-dark'])('%s theme contrast', mode => {
  it('uses accessible accent and onPrimary colors from the actual ThemeProvider', () => {
    mockThemeMode = mode;
    let theme: Theme | undefined;
    const ReadTheme = () => {
      theme = useTheme();
      return null;
    };
    let view: renderer.ReactTestRenderer | undefined;
    act(() => {
      view = renderer.create(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(ReadTheme),
        ),
      );
    });

    try {
      expect(theme!.glass).toBeDefined();
      expect(
        contrast(theme!.colors.onPrimary, rgb(theme!.colors.primary)),
      ).toBeGreaterThanOrEqual(4.5);
      // Cover both extremes under a translucent card, including custom artwork.
      for (const backdrop of ['#000000', '#FFFFFF']) {
        const surface = composite(theme!.colors.surface, rgb(backdrop));
        for (const role of textRoles) {
          expect(contrast(theme!.colors[role], surface)).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    } finally {
      act(() => view?.unmount());
    }
  });
});
