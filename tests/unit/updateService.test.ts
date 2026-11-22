jest.mock('electron', () => ({
  app: {
    getVersion: jest.fn(() => '1.0.0'),
  },
  net: {
    fetch: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
}));

import {
  DEFAULT_UPDATE_SOURCE,
  UpdateService,
} from '../../desktop/main/updater/updateService';

describe('UpdateService', () => {
  it('默认使用 Nyami GitHub Releases 更新源', () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
    } as never;
    const service = new UpdateService(logger);

    expect(service.getStatus()).toMatchObject({
      status: 'idle',
      source: DEFAULT_UPDATE_SOURCE,
    });
  });
});
