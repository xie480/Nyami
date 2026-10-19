import React from 'react';
import {afterEach, describe, expect, it, jest} from '@jest/globals';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {Button} from '../../src/components/Button';
import {Slider} from '../../src/components/Slider';

let mockTrackX = 20;
let mockTrackWidth = 100;

jest.mock('react-native', () => {
  const ReactMock = require('react');
  return {
    View: 'View',
    Text: 'Text',
    ActivityIndicator: 'ActivityIndicator',
    // Model the native touchable contract: disabled controls do not dispatch presses.
    TouchableOpacity: (props: any) =>
      ReactMock.createElement('TouchableOpacity', {
        ...props,
        onPress: props.disabled ? undefined : props.onPress,
      }),
    StyleSheet: {create: (styles: any) => styles},
    PanResponder: {create: (handlers: any) => ({panHandlers: handlers})},
  };
});

jest.mock('../../src/theme', () => ({
  useTheme: () => ({
    colors: require('../../src/theme/colors').lightColors,
    spacing: require('../../src/theme/spacing').spacing,
    radius: require('../../src/theme/spacing').radius,
    fontSize: require('../../src/theme/typography').fontSize,
  }),
}));

describe('UI control interaction contracts', () => {
  let view: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => view?.unmount());
    view = undefined;
    mockTrackX = 20;
    mockTrackWidth = 100;
  });

  function render(element: React.ReactElement) {
    act(() => {
      view = renderer.create(element, {
        createNodeMock: () => ({
          measureInWindow: (callback: (...values: number[]) => void) =>
            callback(mockTrackX, 0, mockTrackWidth, 4),
        }),
      });
    });
  }

  function slider() {
    return view!.root.findByProps({accessibilityRole: 'adjustable'});
  }

  function adjust(actionName: 'increment' | 'decrement') {
    act(() => {
      slider().props.onAccessibilityAction({nativeEvent: {actionName}});
    });
  }

  it('blocks presses while Button is loading and exposes busy and disabled states', () => {
    const onPress = jest.fn();
    render(<Button title="保存设置" loading onPress={onPress} />);
    const touchable = view!.root.findByType('TouchableOpacity' as any);

    expect(touchable.props.accessibilityLabel).toBe('保存设置');
    expect(touchable.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(touchable.props.onPress).toBeUndefined();
    expect(view!.root.findAllByType('ActivityIndicator' as any)).toHaveLength(
      1,
    );
    expect(onPress).not.toHaveBeenCalled();

    act(() => {
      view!.update(<Button title="保存设置" onPress={onPress} />);
    });
    act(() => {
      view!.root.findByType('TouchableOpacity' as any).props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(
      view!.root.findByType('TouchableOpacity' as any).props.accessibilityState,
    ).toEqual({busy: false, disabled: false});
  });

  it('keeps an explicitly disabled Button unavailable without announcing loading', () => {
    render(<Button title="导入关键词" disabled onPress={jest.fn()} />);
    const touchable = view!.root.findByType('TouchableOpacity' as any);
    expect(touchable.props.onPress).toBeUndefined();
    expect(touchable.props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
  });

  it('uses current Slider disabled state even through retained native gesture handlers', () => {
    const onValueChange = jest.fn();
    render(<Slider value={30} onValueChange={onValueChange} />);
    const initialHandlers = slider().props;
    expect(initialHandlers.onStartShouldSetPanResponder()).toBe(true);

    act(() => {
      view!.update(
        <Slider value={30} disabled onValueChange={onValueChange} />,
      );
    });
    expect(initialHandlers.onStartShouldSetPanResponder()).toBe(false);
    expect(initialHandlers.onMoveShouldSetPanResponder()).toBe(false);
    expect(slider().props.accessibilityState.disabled).toBe(true);
    act(() => {
      initialHandlers.onPanResponderGrant({nativeEvent: {pageX: 80}});
      initialHandlers.onPanResponderMove({nativeEvent: {pageX: 100}});
    });
    adjust('increment');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('uses current Slider callback and range after rerender and remeasures after scrolling', () => {
    const initialChange = jest.fn();
    const currentChange = jest.fn();
    render(<Slider value={30} onValueChange={initialChange} />);
    const initialHandlers = slider().props;

    act(() => {
      view!.update(
        <Slider
          value={2}
          minimumValue={2}
          maximumValue={10}
          step={4}
          onValueChange={currentChange}
        />,
      );
    });
    mockTrackX = 80;
    mockTrackWidth = 200;
    act(() => {
      initialHandlers.onPanResponderGrant({nativeEvent: {pageX: 180}});
      initialHandlers.onPanResponderMove({nativeEvent: {pageX: 999}});
    });
    expect(initialChange).not.toHaveBeenCalled();
    expect(currentChange.mock.calls.map(call => call[0])).toEqual([6, 10]);
  });

  it('anchors accessible Slider increments at the minimum and clamps both bounds', () => {
    const onValueChange = jest.fn();
    const props = {minimumValue: 2, maximumValue: 11, step: 4, onValueChange};
    render(<Slider {...props} value={2} accessibilityLabel="均衡增益" />);
    expect(slider().props.accessibilityLabel).toBe('均衡增益');
    adjust('increment');
    expect(onValueChange).toHaveBeenLastCalledWith(6);

    act(() => view!.update(<Slider {...props} value={11} />));
    adjust('increment');
    expect(onValueChange).toHaveBeenLastCalledWith(11);
    act(() => view!.update(<Slider {...props} value={2} />));
    adjust('decrement');
    expect(onValueChange).toHaveBeenLastCalledWith(2);
  });

  it('uses the latest Slider value and continuous range for accessible adjustments', () => {
    const onValueChange = jest.fn();
    render(<Slider value={10} onValueChange={onValueChange} />);
    act(() => {
      view!.update(
        <Slider
          value={140}
          minimumValue={100}
          maximumValue={300}
          step={0}
          accessibilityValueText="140 赫兹"
          onValueChange={onValueChange}
        />,
      );
    });
    adjust('increment');
    expect(onValueChange).toHaveBeenLastCalledWith(142);
    expect(slider().props.accessibilityValue).toEqual({
      min: 100,
      max: 300,
      now: 140,
      text: '140 赫兹',
    });
  });
});
