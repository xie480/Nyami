import type {
  DesktopAudioSettings,
  DesktopPeqBand,
  DesktopSettingsPatch,
} from '../../shared/types';
import {
  DESKTOP_GRAPHIC_PRESETS,
  GRAPHIC_BAND_FREQUENCIES,
  getPresetGains,
} from './eqPresets';

type AudioSettingsPanelProps = {
  settings: DesktopAudioSettings;
  onUpdate: (patch: DesktopSettingsPatch) => void;
};

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
        <span className={settings.enabled ? 'status-chip active' : 'status-chip'}>
          {settings.enabled ? '处理中' : '直通'}
        </span>
      </div>
      <label className="setting-row">
        <span>
          <strong>启用桌面 DSP</strong>
          <small>AudioWorklet 在音频线程处理 EQ 和 Limiter，关闭后保持直通。</small>
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
          <select
            aria-label="EQ 模式"
            onChange={event =>
              updateAudio({
                mode: event.target.value as DesktopAudioSettings['mode'],
              })
            }
            value={settings.mode}>
            <option value="graphic">Graphic EQ</option>
            <option value="parametric">PEQ</option>
          </select>
        </label>
        <label className="audio-select-control">
          <span>Graphic 预设</span>
          <select
            aria-label="Graphic EQ 预设"
            onChange={event => {
              const preset = event.target.value as DesktopAudioSettings['graphicPreset'];
              updateAudio({
                graphicPreset: preset,
                graphicGains: getPresetGains(preset),
              });
            }}
            value={settings.graphicPreset}>
            {DESKTOP_GRAPHIC_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {settings.graphicPreset === 'custom' ? (
              <option value="custom">自定义</option>
            ) : null}
          </select>
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
                <span>频率</span>
                <input
                  aria-label={`PEQ ${index + 1} 频率`}
                  max="20000"
                  min="20"
                  onChange={event =>
                    updatePeqBand(index, {frequency: Number(event.target.value)})
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
          <strong>实时频谱</strong>
          <small>以 30 Hz 上限发送 128 段 FFT 数据，降低列表滚动时的主线程开销。</small>
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
