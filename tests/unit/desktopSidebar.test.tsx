import React from 'react';
import renderer from 'react-test-renderer';
import {Sidebar} from '../../desktop/renderer/App';

describe('桌面端侧边栏', () => {
  it('已登录时音乐库导航不显示账号提示', () => {
    const tree = renderer.create(
      <Sidebar
        auth={{loggedIn: true, uid: '1'}}
        onLogin={jest.fn()}
        onRouteChange={jest.fn()}
        profile={null}
        route="library"
      />,
    );
    const libraryNav = tree.root.findByProps({
      className: 'nav-item active',
    });

    expect(libraryNav.findAllByProps({className: 'nav-hint'})).toHaveLength(0);
  });

  it('设置导航图标使用线性齿轮轮廓', () => {
    const tree = renderer.create(
      <Sidebar
        auth={{loggedIn: false, uid: null}}
        onLogin={jest.fn()}
        onRouteChange={jest.fn()}
        profile={null}
        route="settings"
      />,
    );
    const settingsNav = tree.root.findByProps({
      className: 'nav-item active',
    });
    const settingsIcon = settingsNav.findByType('svg');

    const settingsPath = settingsIcon.findByType('path');

    expect(settingsIcon.props.viewBox).toBe('0 0 24 24');
    expect(settingsPath.props.fill).toBeUndefined();
    expect(settingsPath.props.stroke).toBeUndefined();
    expect(settingsIcon.findByType('circle').props.r).toBe('3');
  });
});
