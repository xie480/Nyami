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
});
