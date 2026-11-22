import {assertAudioSettingsPatch} from '../../desktop/main/ipc/audioSettingsValidation';

describe('桌面音频设置 IPC 校验', () => {
  it('允许保存响度开关和响度目标', () => {
    expect(() =>
      assertAudioSettingsPatch({
        loudnessEnabled: true,
        loudnessTargetDb: -16.5,
      }),
    ).not.toThrow();
  });

  it('拒绝越过 AudioWorklet 支持范围的响度目标', () => {
    expect(() =>
      assertAudioSettingsPatch({loudnessTargetDb: -30}),
    ).toThrow('响度目标无效');
    expect(() =>
      assertAudioSettingsPatch({loudnessTargetDb: -8}),
    ).toThrow('响度目标无效');
  });
});
