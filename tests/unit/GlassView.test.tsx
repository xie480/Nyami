import React from 'react';
import {afterEach, describe, expect, it, jest} from '@jest/globals';
import renderer, {act} from 'react-test-renderer';
import {GlassView} from '../../src/components/GlassView';

let mockThemeMode = 'glass-light';
let mockBlurAmount = 28;

jest.mock('react-native', () => ({
  View: 'View',
  Platform: {OS: 'android'},
  StyleSheet: {hairlineWidth: 0.5, absoluteFill: {position: 'absolute'}},
  InteractionManager: {
    runAfterInteractions: (callback: () => void) => {
      callback();
      return {cancel: jest.fn()};
    },
  },
}));
jest.mock('@react-native-community/blur', () => ({BlurView: 'BlurView'}));
jest.mock('../../src/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: {glassBlurAmount: number}) => unknown) =>
    selector({glassBlurAmount: mockBlurAmount}),
}));
jest.mock('../../src/theme', () => ({
  useTheme: () => {
    const {
      GlassLightTheme,
      GlassDarkTheme,
    } = require('../../src/theme/glassTheme');
    const {lightColors, darkColors} = require('../../src/theme/colors');
    return {
      isDark: mockThemeMode.endsWith('dark'),
      colors: mockThemeMode.endsWith('dark') ? darkColors : lightColors,
      radius: {xl: 24},
      glass: mockThemeMode.startsWith('glass')
        ? mockThemeMode === 'glass-light'
          ? GlassLightTheme
          : GlassDarkTheme
        : undefined,
    };
  },
}));

describe('glass material native rendering', () => {
  let view: renderer.ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => view?.unmount());
    view = undefined;
    mockThemeMode = 'glass-light';
    mockBlurAmount = 28;
  });

  function render(element = <GlassView>content</GlassView>) {
    act(() => {
      view = renderer.create(element);
    });
  }

  function contentTints() {
    return view!.root
      .findAllByType('View' as any)
      .flatMap(node =>
        (node.props.style ?? []).filter(
          (style: any) =>
            style?.backgroundColor && style.backgroundColor !== 'transparent',
        ),
      );
  }

  it.each(['glass-light', 'glass-dark'])(
    '%s draws a single theme tint inside the Android native material',
    mode => {
      mockThemeMode = mode;
      render();
      const blur = view!.root.findByType('BlurView' as any);
      const {
        GlassLightTheme,
        GlassDarkTheme,
      } = require('../../src/theme/glassTheme');
      expect(blur.props.overlayColor).toBe(
        (mode === 'glass-light' ? GlassLightTheme : GlassDarkTheme).colors.glass
          .bg,
      );
      expect(contentTints()).toHaveLength(0);
      expect(blur.props.blurAmount).toBeGreaterThan(0);
      expect(blur.props.reducedTransparencyFallbackColor).toMatch(/^#/);
    },
  );

  it('skips the native zero-radius path and restores blur when increased', () => {
    mockBlurAmount = 0;
    render();
    expect(view!.root.findAllByType('BlurView' as any)).toHaveLength(0);
    expect(contentTints()).toHaveLength(1);
    mockBlurAmount = 20;
    act(() => view!.update(<GlassView>content</GlassView>));
    expect(view!.root.findByType('BlurView' as any).props.blurAmount).toBe(20);
    expect(contentTints()).toHaveLength(0);
  });

  it('keeps ordinary themes and explicitly lightweight list surfaces blur-free', () => {
    mockThemeMode = 'light';
    render();
    expect(view!.root.findAllByType('BlurView' as any)).toHaveLength(0);
    mockThemeMode = 'glass-light';
    for (const props of [{minimal: true}, {noBlur: true}]) {
      act(() => view!.update(<GlassView {...props}>content</GlassView>));
      expect(view!.root.findAllByType('BlurView' as any)).toHaveLength(0);
    }
    act(() => view!.update(<GlassView>content</GlassView>));
    expect(view!.root.findAllByType('BlurView' as any)).toHaveLength(1);
  });
});
