import React from 'react';
import {afterEach, describe, expect, it, jest} from '@jest/globals';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {EQSlider} from '../../src/components/eq/EQSlider';

jest.mock('react-native', () => {
  class AnimatedValue {
    setValue() {}
    interpolate() { return 0; }
  }
  const animation = () => ({start: jest.fn()});
  return {
    View: 'View',
    Text: 'Text',
    StyleSheet: {create: (styles: any) => styles, absoluteFill: {}},
    Platform: {OS: 'android'},
    PanResponder: {create: (handlers: any) => ({panHandlers: handlers})},
    Animated: {
      Value: AnimatedValue,
      View: 'AnimatedView',
      spring: animation,
      timing: animation,
      parallel: animation,
    },
  };
});
jest.mock('../../src/theme', () => ({
  useTheme: () => ({colors: require('../../src/theme/colors').lightColors}),
}));

describe('EQSlider gesture ownership', () => {
  let view: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => view?.unmount());
    view = undefined;
  });

  function render(element: React.ReactElement) {
    act(() => {
      view = renderer.create(element, {
        createNodeMock: () => ({
          measureInWindow: (callback: (...values: number[]) => void) =>
            callback(0, 100, 48, 100),
        }),
      });
    });
  }

  function trackHandlers() {
    return view!.root.find(node =>
      typeof node.props.onMoveShouldSetPanResponder === 'function',
    ).props;
  }

  it('leaves taps, horizontal swipes and diagonal swipes to the parent list', () => {
    const onValueChange = jest.fn();
    render(<EQSlider label="1k" value={0} onValueChange={onValueChange} />);
    const handlers = trackHandlers();

    expect(handlers.onStartShouldSetPanResponder()).toBe(false);
    expect(handlers.onStartShouldSetPanResponderCapture()).toBe(false);
    expect(handlers.onMoveShouldSetPanResponderCapture()).toBe(false);
    for (const gesture of [
      {dx: 40, dy: 2},
      {dx: -40, dy: 3},
      {dx: 12, dy: 12},
      {dx: 0, dy: 0},
    ]) {
      expect(handlers.onMoveShouldSetPanResponder(null, gesture)).toBe(false);
    }
    // Move/release events outside an acquired vertical drag cannot mutate gain.
    act(() => {
      handlers.onPanResponderMove({nativeEvent: {pageY: 120}});
      handlers.onPanResponderRelease();
    });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('claims vertical intent only after the movement threshold and still adjusts gain', () => {
    const onValueChange = jest.fn();
    render(<EQSlider label="1k" value={0} onValueChange={onValueChange} />);
    const handlers = trackHandlers();

    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 0, dy: 5})).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 0, dy: 6})).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 2, dy: 9})).toBe(true);
    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 2, dy: -9})).toBe(true);
    act(() => {
      handlers.onPanResponderGrant();
      handlers.onPanResponderMove({nativeEvent: {pageY: 120}});
      handlers.onPanResponderRelease();
    });
    expect(onValueChange).toHaveBeenCalledWith(7);
  });

  it('reads the current disabled state after rerender through retained native handlers', () => {
    const onValueChange = jest.fn();
    render(<EQSlider label="1k" value={0} onValueChange={onValueChange} />);
    const handlers = trackHandlers();
    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 0, dy: 10})).toBe(true);

    act(() => {
      view!.update(<EQSlider label="1k" value={0} disabled onValueChange={onValueChange} />);
    });
    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 0, dy: 10})).toBe(false);
    act(() => {
      handlers.onPanResponderGrant();
      handlers.onPanResponderMove({nativeEvent: {pageY: 120}});
      handlers.onPanResponderRelease();
      view!.root.findByProps({accessibilityRole: 'adjustable'})
        .props.onAccessibilityAction({nativeEvent: {actionName: 'increment'}});
    });
    expect(onValueChange).not.toHaveBeenCalled();

    act(() => {
      view!.update(<EQSlider label="1k" value={0} onValueChange={onValueChange} />);
    });
    expect(handlers.onMoveShouldSetPanResponder(null, {dx: 0, dy: 10})).toBe(true);
  });

  it('preserves bounded screen-reader gain adjustments without requiring a drag', () => {
    const onValueChange = jest.fn();
    render(<EQSlider label="1k" value={12} onValueChange={onValueChange} />);
    const control = view!.root.findByProps({accessibilityRole: 'adjustable'});
    act(() => {
      control.props.onAccessibilityAction({nativeEvent: {actionName: 'increment'}});
      control.props.onAccessibilityAction({nativeEvent: {actionName: 'decrement'}});
    });
    expect(onValueChange.mock.calls.map(call => call[0])).toEqual([12, 11]);
  });
});
