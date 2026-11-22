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

  it('默认 GitHub Releases 尚未发布时返回明确提示', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
    } as never;
    const service = new UpdateService(logger, {
      fetcher: jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as never,
    });

    const result = await service.check();

    expect(result).toMatchObject({
      status: 'error',
      error: 'Nyami GitHub Releases 尚未发布桌面端安装包',
    });
  });
});
