/**
 * useSpectrumPoller - 实时频谱数据轮询 Hook
 *
 * 以固定间隔从 Native DSPAudioProcessor 获取 FFT 频谱数据，
 * 供 SpectrumView 组件渲染。
 *
 * 数据流：
 *   DSPAudioProcessor.fftAnalyzer.spectrum
 *     → AudioDSPModule.getSpectrumData() [Native Bridge]
 *       → useSpectrumPoller [JS, ~80ms polling]
 *         → SpectrumView.spectrumData prop [Native UI Component]
 *           → SpectrumGLSurfaceView.updateSpectrum() [OpenGL ES 2.0]
 *
 * 包含指数移动平均 (EMA) 平滑，减少帧间视觉跳动。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import LoggerService from '../services/LoggerService';
import { audioDSP } from '../native/AudioDSPModule';

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 80; // ~12.5 fps，平衡性能与流畅度

/** 平滑系数表示当前样本对输出的权重，分别控制上升与回落速度。 */
const SPECTRUM_SMOOTHING = {
  attack: 0.78,
  release: 0.42,
};

/** 调试模式：打印频谱数据长度（仅在开发环境生效） */
const DEBUG = __DEV__;

export interface SpectrumData {
  /** 128-bin 归一化频段电平 (0~0.98) */
  spectrum: number[];
  /** 猫耳左声道 16-bin */
  catEarLeft: number[];
  /** 猫耳右声道 16-bin */
  catEarRight: number[];
}

const DEBUG_LOG_INTERVAL_MS = 10_000;

/**
 * 对两个等长数组应用非对称 EMA：上升快速跟随，回落保留更长余韵。
 */
function smoothArray(prev: number[], next: number[]): number[] {
  if (prev.length === 0) return next;
  const len = Math.min(prev.length, next.length);
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const factor =
      next[i] > prev[i] ? SPECTRUM_SMOOTHING.attack : SPECTRUM_SMOOTHING.release;
    result[i] = prev[i] + (next[i] - prev[i]) * factor;
  }
  return result;
}

/**
 * 实时频谱数据 Hook
 *
 * @param enabled 是否启用轮询（页面显示时启用，离开时停用）
 * @returns 当前频谱数据，包含 spectrum / catEarLeft / catEarRight
 */
export function useSpectrumPoller(enabled: boolean = true): SpectrumData {
  const [data, setData] = useState<SpectrumData>({
    spectrum: [],
    catEarLeft: [],
    catEarRight: [],
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // 存储上一帧的平滑数据
  const smoothRef = useRef<SpectrumData>({
    spectrum: [],
    catEarLeft: [],
    catEarRight: [],
  });
  const pollInFlightRef = useRef(false);
  const lastDebugLogAtRef = useRef(0);

  const poll = useCallback(async () => {
    // 仅在 Android 上有效
    if (Platform.OS !== 'android' || pollInFlightRef.current) return;
    pollInFlightRef.current = true;

    try {
      const result = await audioDSP.getSpectrumData();
      if (
        result &&
        result.spectrum &&
        result.spectrum.length > 0
      ) {
        // 应用 EMA 平滑
        const smoothedSpectrum = smoothArray(smoothRef.current.spectrum, result.spectrum);
        const smoothedLeft = smoothArray(smoothRef.current.catEarLeft, result.catEarLeft ?? []);
        const smoothedRight = smoothArray(smoothRef.current.catEarRight, result.catEarRight ?? []);

        // 更新平滑缓存
        smoothRef.current = {
          spectrum: smoothedSpectrum,
          catEarLeft: smoothedLeft,
          catEarRight: smoothedRight,
        };

        setData({
          spectrum: smoothedSpectrum,
          catEarLeft: smoothedLeft,
          catEarRight: smoothedRight,
        });

        const now = Date.now();
        if (DEBUG && now - lastDebugLogAtRef.current >= DEBUG_LOG_INTERVAL_MS) {
          lastDebugLogAtRef.current = now;
          LoggerService.debug(
            'useSpectrumPoller',
            'poll',
            `spectrum=${smoothedSpectrum.length} bins, ` +
            `left=${smoothedLeft.length} bins, right=${smoothedRight.length} bins`,
          );
        }
      } else if (
        DEBUG &&
        Date.now() - lastDebugLogAtRef.current >= DEBUG_LOG_INTERVAL_MS
      ) {
        lastDebugLogAtRef.current = Date.now();
        LoggerService.warn('useSpectrumPoller', 'poll', 'Native getSpectrumData() returned empty data');
      }
    } catch (e) {
      if (
        DEBUG &&
        Date.now() - lastDebugLogAtRef.current >= DEBUG_LOG_INTERVAL_MS
      ) {
        lastDebugLogAtRef.current = Date.now();
        LoggerService.warn('useSpectrumPoller', 'poll', 'Native module error:', e);
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;

    // 启动轮询
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    // 立即执行一次
    poll();

    // 监听 AppState 变化，后台时暂停轮询以省电
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (prevState === 'active' && (nextState === 'background' || nextState === 'inactive')) {
        // 进入后台 → 停止轮询
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if ((prevState === 'background' || prevState === 'inactive') && nextState === 'active') {
        // 回到前台 → 恢复轮询
        intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
        poll();
      }
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      subscription.remove();
    };
  }, [enabled, poll]);

  return data;
}
