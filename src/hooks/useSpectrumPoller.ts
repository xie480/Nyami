/**
 * useSpectrumPoller - 实时频谱数据轮询 Hook
 *
 * 以固定间隔从 Native DSPAudioProcessor 获取 FFT 频谱数据，
 * 供 SpectrumView 组件渲染。
 *
 * 数据流：
 *   DSPAudioProcessor.fftAnalyzer.spectrum
 *     → AudioDSPModule.getSpectrumData() [Native Bridge]
 *       → useSpectrumPoller [JS, default 80ms; playback ring 40ms]
 *         → SpectrumView.spectrumData prop [Native UI Component]
 *           → SpectrumGLSurfaceView.updateSpectrum() [OpenGL ES 2.0]
 *
 * 包含指数移动平均 (EMA) 平滑，减少帧间视觉跳动。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import LoggerService from '../services/LoggerService';
import { audioDSP } from '../native/AudioDSPModule';

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 80; // ~12.5 fps，平衡性能与流畅度
const SMOOTHING_REFERENCE_INTERVAL_MS = POLL_INTERVAL_MS;

/** 平滑系数表示当前样本对输出的权重，分别控制上升与回落速度。 */
const SPECTRUM_SMOOTHING = {
  attack: 0.78,
  release: 0.42,
};

let activeSpectrumConsumers = 0;

function setSpectrumConsumerActive(active: boolean): void {
  const wasEnabled = activeSpectrumConsumers > 0;
  activeSpectrumConsumers = active
    ? activeSpectrumConsumers + 1
    : Math.max(0, activeSpectrumConsumers - 1);
  const isEnabled = activeSpectrumConsumers > 0;

  if (wasEnabled !== isEnabled) {
    try {
      audioDSP.setSpectrumEnabled(isEnabled);
    } catch {
      // iOS 或原生模块未注册时由空实现忽略。
    }
  }
}

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
function smoothArray(
  prev: number[],
  next: number[],
  attack: number,
  release: number,
): number[] {
  if (prev.length === 0) return next;
  const len = Math.min(prev.length, next.length);
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const factor = next[i] > prev[i] ? attack : release;
    result[i] = prev[i] + (next[i] - prev[i]) * factor;
  }
  return result;
}

/**
 * 实时频谱数据 Hook
 *
 * @param enabled 是否启用轮询（页面显示时启用，离开时停用）
 * @param pollIntervalMs 采样间隔；播放环使用 40ms，其他页面默认 80ms
 * @param maxSpectrumBins 请求的最大频段数
 * @param includeCatEars 是否同时读取猫耳数据
 * @returns 当前频谱数据，包含 spectrum / catEarLeft / catEarRight
 */
export function useSpectrumPoller(
  enabled: boolean = true,
  pollIntervalMs: number = POLL_INTERVAL_MS,
  maxSpectrumBins: number = 128,
  includeCatEars: boolean = true,
): SpectrumData {
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
  const smoothing = useMemo(() => {
    const intervalRatio = pollIntervalMs / SMOOTHING_REFERENCE_INTERVAL_MS;
    return {
      attack: 1 - (1 - SPECTRUM_SMOOTHING.attack) ** intervalRatio,
      release: 1 - (1 - SPECTRUM_SMOOTHING.release) ** intervalRatio,
    };
  }, [pollIntervalMs]);

  const poll = useCallback(async () => {
    // 仅在 Android 上有效
    if (
      Platform.OS !== 'android' ||
      appStateRef.current !== 'active' ||
      pollInFlightRef.current
    ) return;
    pollInFlightRef.current = true;

    try {
      const result = await audioDSP.getSpectrumData(
        maxSpectrumBins,
        includeCatEars,
      );
      if (
        result &&
        result.spectrum &&
        result.spectrum.length > 0
      ) {
        // 应用 EMA 平滑
        const smoothedSpectrum = smoothArray(
          smoothRef.current.spectrum,
          result.spectrum,
          smoothing.attack,
          smoothing.release,
        );
        const smoothedLeft = smoothArray(
          smoothRef.current.catEarLeft,
          result.catEarLeft ?? [],
          smoothing.attack,
          smoothing.release,
        );
        const smoothedRight = smoothArray(
          smoothRef.current.catEarRight,
          result.catEarRight ?? [],
          smoothing.attack,
          smoothing.release,
        );

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
  }, [includeCatEars, maxSpectrumBins, smoothing]);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;

    let consumerActive = false;
    const start = () => {
      if (intervalRef.current) return;
      if (!consumerActive) {
        setSpectrumConsumerActive(true);
        consumerActive = true;
      }
      intervalRef.current = setInterval(poll, pollIntervalMs);
      poll();
    };
    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (consumerActive) {
        setSpectrumConsumerActive(false);
        consumerActive = false;
      }
    };

    appStateRef.current = AppState.currentState;
    if (appStateRef.current === 'active') start();

    // 页面离开或应用进入后台时停止轮询，并暂停原生 FFT。
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState === 'active') start();
      else stop();
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [enabled, poll, pollIntervalMs]);

  return data;
}
