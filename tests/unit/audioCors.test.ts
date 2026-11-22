import {withAudioCorsHeaders} from '../../desktop/main/audio/audioCors';

describe('桌面音频 CORS 响应头', () => {
  it('覆盖旧 CORS 配置并保留其他响应头', () => {
    const original = {
      'Content-Length': ['128'],
      'access-control-allow-origin': ['https://old.example.test'],
      'Access-Control-Expose-Headers': ['X-Old'],
      'Content-Type': ['audio/mp4'],
    };

    const next = withAudioCorsHeaders(original);

    expect(next).toMatchObject({
      'Content-Length': ['128'],
      'Content-Type': ['audio/mp4'],
      'Access-Control-Allow-Origin': ['*'],
      'Access-Control-Expose-Headers': [
        'Accept-Ranges, Content-Length, Content-Range, Content-Type',
      ],
    });
    expect(original['access-control-allow-origin']).toEqual([
      'https://old.example.test',
    ]);
    expect(next['access-control-allow-origin']).toBeUndefined();
  });
});
