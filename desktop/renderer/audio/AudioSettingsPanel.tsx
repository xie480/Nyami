import type {
  DesktopAudioSettings,
  DesktopPeqBand,
  DesktopPeqFilterType,
  DesktopSettingsPatch,
} from '../../shared/types';
import {
  DESKTOP_GRAPHIC_PRESETS,
  GRAPHIC_BAND_FREQUENCIES,
  getPresetGains,
} from './eqPresets';
import {PrototypeSelect} from '../PrototypePages';

type AudioSettingsPanelProps = {
  settings: DesktopAudioSettings;
  onUpdate: (patch: DesktopSettingsPatch) => void;
};

const PEQ_FILTER_OPTIONS: ReadonlyArray<{
  value: DesktopPeqFilterType;
  label: string;
}> = [
  {value: 'Peak', label: '峰值 · Peak'},
  {value: 'LowShelf', label: '低频搁架'},
  {value: 'HighShelf', label: '高频搁架'},
  {value: 'LowPass', label: '低通'},
  {value: 'HighPass', label: '高通'},
  {value: 'Notch', label: '陷波'},
  {value: 'BandPass', label: '带通'},
];

/**
 * 桌面端音频设置面板。
 * 通过完整参数快照驱动 AudioWorklet，保证重启后的设置和实时听感一致。
 */
export function AudioSettingsPanel({
  onUpdate,
  settings,
}: AudioSettingsPanelProps): JSX.Element {
  const updateAudio = (patch: Partial<DesktopAudioSettings>): void => {
    onUpdate({audio: patch});
  };

  const updateGraphicGain = (index: number, value: number): void => {
    const gains = [...settings.graphicGains];
    gains[index] = value;
    updateAudio({
      graphicPreset: 'custom',
      graphicGains: gains,
    });
  };

  const updatePeqBand = (
    index: number,
    patch: Partial<DesktopPeqBand>,
  ): void => {
    const bands = settings.peqBands.map((band, bandIndex) =>
      bandIndex === index ? {...band, ...patch} : {...band},
    );
    updateAudio({peqBands: bands});
  };

  return (
    <section className="settings-card audio-settings-card">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">AUDIO LAB</p>
          <h3>均衡器与频谱</h3>
        </div>
        <span
          className={settings.enabled ? 'status-chip active' : 'status-chip'}>
          {settings.enabled ? '处理中' : '直通'}
        </span>
      </div>
      <label className="setting-row">
        <span>
          <strong>启用桌面 DSP</strong>
          <small>
            AudioWorklet 在音频线程处理 EQ 和 Limiter，关闭后保持直通。
          </small>
        </span>
        <input
          aria-label="启用桌面 DSP"
          checked={settings.enabled}
          onChange={event => updateAudio({enabled: event.target.checked})}
          type="checkbox"
        />
      </label>
      <div className="audio-control-row">
        <label className="audio-select-control">
          <span>EQ 模式</span>
          <PrototypeSelect
            ariaLabel="EQ 模式"
            className="audio-settings-select"
            onChange={value =>
              updateAudio({
                mode: value as DesktopAudioSettings['mode'],
              })
            }
            options={[
              {value: 'graphic', label: 'Graphic EQ'},
              {value: 'parametric', label: 'PEQ'},
            ]}
            value={settings.mode}
          />
        </label>
        <label className="audio-select-control">
          <span>Graphic 预设</span>
          <PrototypeSelect
            ariaLabel="Graphic EQ 预设"
            className="audio-settings-select"
            onChange={value => {
              const preset = value as DesktopAudioSettings['graphicPreset'];
              updateAudio({
                graphicPreset: preset,
                graphicGains: getPresetGains(preset),
              });
            }}
            options={[
              ...DESKTOP_GRAPHIC_PRESETS.map(preset => ({
                value: preset.id,
                label: preset.label,
              })),
              ...(settings.graphicPreset === 'custom'
                ? [{value: 'custom', label: '自定义'}]
                : []),
            ]}
            value={settings.graphicPreset}
          />
        </label>
      </div>
      {settings.mode === 'graphic' ? (
        <div className="graphic-eq-grid" aria-label="十段 Graphic EQ">
          {GRAPHIC_BAND_FREQUENCIES.map((frequency, index) => (
            <label className="graphic-band" key={frequency}>
              <span>{formatFrequency(frequency)}</span>
              <input
                aria-label={`${formatFrequency(frequency)} Hz 增益`}
                max="12"
                min="-12"
                onChange={event =>
                  updateGraphicGain(index, Number(event.target.value))
                }
                step="0.5"
                type="range"
                value={settings.graphicGains[index] ?? 0}
              />
              <small>{formatGain(settings.graphicGains[index] ?? 0)}</small>
            </label>
          ))}
        </div>
      ) : (
        <div className="peq-grid" aria-label="八段 PEQ">
          {settings.peqBands.map((band, index) => (
            <div className="peq-row" key={index}>
              <label className="peq-enable">
                <input
                  aria-label={`启用 PEQ ${index + 1}`}
                  checked={band.enabled}
                  onChange={event =>
                    updatePeqBand(index, {enabled: event.target.checked})
                  }
                  type="checkbox"
                />
                <span>PEQ {index + 1}</span>
              </label>
              <label>
                <span>滤波器类型</span>
                <PrototypeSelect
                  ariaLabel={`PEQ ${index + 1} 滤波器类型`}
                  className="audio-settings-select"
                  onChange={value =>
                    updatePeqBand(index, {
                      type: value as DesktopPeqFilterType,
                    })
                  }
                  options={PEQ_FILTER_OPTIONS.slice()}
                  value={band.type}
                />
              </label>
              <label>
                <span>频率</span>
                <input
                  aria-label={`PEQ ${index + 1} 频率`}
                  max="20000"
                  min="20"
                  onChange={event =>
                    updatePeqBand(index, {
                      frequency: Number(event.target.value),
                    })
                  }
                  step="1"
                  type="number"
                  value={band.frequency}
                />
              </label>
              <label>
                <span>增益</span>
                <input
                  aria-label={`PEQ ${index + 1} 增益`}
                  max="18"
                  min="-18"
                  onChange={event =>
                    updatePeqBand(index, {gain: Number(event.target.value)})
                  }
                  step="0.5"
                  type="number"
                  value={band.gain}
                />
              </label>
              <label>
                <span>Q</span>
                <input
                  aria-label={`PEQ ${index + 1} Q 值`}
                  max="20"
                  min="0.1"
                  onChange={event =>
                    updatePeqBand(index, {q: Number(event.target.value)})
                  }
                  step="0.1"
                  type="number"
                  value={band.q}
                />
              </label>
            </div>
          ))}
        </div>
      )}
      <label className="setting-row">
        <span>
          <strong>Limiter</strong>
          <small>限制 EQ 增益产生的峰值，避免削波失真。</small>
        </span>
        <input
          aria-label="启用 Limiter"
          checked={settings.limiterEnabled}
          onChange={event =>
            updateAudio({limiterEnabled: event.target.checked})
          }
          type="checkbox"
        />
      </label>
      <label className="range-setting">
        <span>
          <strong>Limiter 阈值</strong>
          <small>{Math.round(settings.limiterThreshold * 100)}%</small>
        </span>
        <input
          aria-label="Limiter 阈值"
          disabled={!settings.limiterEnabled}
          max="1"
          min="0.5"
          onChange={event =>
            updateAudio({limiterThreshold: Number(event.target.value)})
          }
          step="0.01"
          type="range"
          value={settings.limiterThreshold}
        />
      </label>
      <label className="setting-row">
        <span>
          <strong>响度匹配</strong>
          <small>缓慢跟随短期 RMS，减少不同音轨切换时的音量落差，增益限制在 ±6 dB。</small>
        </span>
        <input
          aria-label="启用响度匹配"
          checked={settings.loudnessEnabled}
          onChange={event =>
            updateAudio({loudnessEnabled: event.target.checked})
          }
          type="checkbox"
        />
      </label>
      <label className="range-setting">
        <span>
          <strong>响度目标</strong>
          <small>{settings.loudnessTargetDb.toFixed(1)} dBFS RMS</small>
        </span>
        <input
          aria-label="响度目标"
          disabled={!settings.loudnessEnabled}
          max="-12"
          min="-24"
          onChange={event =>
            updateAudio({loudnessTargetDb: Number(event.target.value)})
          }
          step="0.5"
          type="range"
          value={settings.loudnessTargetDb}
        />
      </label>
      <label className="setting-row">
        <span>
          <strong>实时频谱</strong>
          <small>
            以 30 Hz 上限发送 128 段 FFT 数据，降低列表滚动时的主线程开销。
          </small>
        </span>
        <input
          aria-label="启用实时频谱"
          checked={settings.spectrumEnabled}
          onChange={event =>
            updateAudio({spectrumEnabled: event.target.checked})
          }
          type="checkbox"
        />
      </label>
    </section>
  );
}

/** 格式化 Graphic EQ 频率标签。 */
function formatFrequency(value: number): string {
  return value >= 1000 ? `${value / 1000}k` : String(value);
}

/** 格式化增益文案，避免正数缺少方向标识。 */
function formatGain(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}
