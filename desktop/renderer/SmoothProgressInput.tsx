import {useEffect, useRef} from 'react';
import type {RefObject} from 'react';
import type {PlaybackSnapshot} from '../shared/types';

const RANGE_THUMB_SIZE = 15;
const RANGE_THUMB_RADIUS = RANGE_THUMB_SIZE / 2;

type SmoothProgressInputProps = {
  ariaLabel: string;
  audioElementRef: RefObject<HTMLAudioElement | null>;
  className?: string;
  onSeek: (position: number) => void;
  playback: PlaybackSnapshot;
};

/** 将播放位置限制在有效时长内，避免音频元数据短暂缺失时出现异常宽度。 */
function clampProgressPosition(position: number, duration: number): number {
  return Math.min(
    duration,
    Math.max(0, Number.isFinite(position) ? position : 0),
  );
}

/** 按滑块中心位置更新填充层，修正原生 range 轨道与滑块坐标系的差异。 */
function updateProgressFill(
  container: HTMLDivElement,
  fill: HTMLSpanElement,
  thumb: HTMLSpanElement,
  ratio: number,
): void {
  const trackWidth = Math.max(0, container.clientWidth);
  const availableTrackWidth = Math.max(
    0,
    trackWidth - RANGE_THUMB_SIZE,
  );
  const fillWidth =
    RANGE_THUMB_RADIUS + Math.min(1, Math.max(0, ratio)) * availableTrackWidth;
  fill.style.width = `${fillWidth}px`;
  thumb.style.left = `${fillWidth}px`;
}

/** 使用音频元素的当前时间驱动进度控件，避免等待 IPC 状态刷新造成跳帧。 */
export function SmoothProgressInput({
  ariaLabel,
  audioElementRef,
  className,
  onSeek,
  playback,
}: SmoothProgressInputProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const playbackRef = useRef(playback);
  const seekRef = useRef(onSeek);
  const draggingRef = useRef(false);
  const duration = Math.max(1, playback.duration);

  playbackRef.current = playback;
  seekRef.current = onSeek;

  useEffect(() => {
    const input = inputRef.current;
    const container = containerRef.current;
    const fill = fillRef.current;
    const thumb = thumbRef.current;
    if (!input || !container || !fill || !thumb) {
      return;
    }
    draggingRef.current = false;
    const position = clampProgressPosition(playback.position, duration);
    input.value = String(position);
    updateProgressFill(container, fill, thumb, position / duration);
  }, [duration, playback.trackId]);

  useEffect(() => {
    if (playback.state === 'playing') {
      return;
    }
    const input = inputRef.current;
    const container = containerRef.current;
    const fill = fillRef.current;
    const thumb = thumbRef.current;
    if (!input || !container || !fill || !thumb || draggingRef.current) {
      return;
    }
    const position = clampProgressPosition(playback.position, duration);
    input.value = String(position);
    updateProgressFill(container, fill, thumb, position / duration);
  }, [duration, playback.position, playback.state]);

  useEffect(() => {
    if (playback.state !== 'playing') {
      return;
    }
    let frame = 0;

    /** 在每个浏览器动画帧同步圆形滑块和已播放轨道。 */
    const renderFrame = (): void => {
      const container = containerRef.current;
      const fill = fillRef.current;
      const thumb = thumbRef.current;
      const input = inputRef.current;
      const snapshot = playbackRef.current;
      if (input && container && fill && thumb) {
        const duration = Math.max(1, snapshot.duration);
        const audio = audioElementRef.current;
        const audioPosition =
          snapshot.state === 'playing' &&
          audio &&
          audio.src &&
          Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : snapshot.position;
        const manualPosition = draggingRef.current
          ? Number(input.value)
          : audioPosition;
        const position = clampProgressPosition(manualPosition, duration);
        if (!draggingRef.current) {
          input.value = String(position);
        }
        updateProgressFill(container, fill, thumb, position / duration);
      }
      frame = window.requestAnimationFrame(renderFrame);
    };

    frame = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(frame);
  }, [audioElementRef, playback.state, playback.trackId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const updateLayout = (): void => {
      const input = inputRef.current;
      const fill = fillRef.current;
      const thumb = thumbRef.current;
      if (!input || !fill || !thumb) {
        return;
      }
      const position = clampProgressPosition(
        Number(input.value),
        Math.max(1, Number(input.max)),
      );
      updateProgressFill(
        container,
        fill,
        thumb,
        position / Math.max(1, Number(input.max)),
      );
    };

    updateLayout();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateLayout);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const initialPosition = clampProgressPosition(playback.position, duration);
  const inputClassName = ['smooth-progress-native', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="smooth-progress-input-container" ref={containerRef}>
      <span aria-hidden="true" className="smooth-progress-rail" />
      <span
        aria-hidden="true"
        className="smooth-progress-fill"
        ref={fillRef}
        style={{width: `${RANGE_THUMB_RADIUS}px`}}
      />
      <span
        aria-hidden="true"
        className="smooth-progress-thumb"
        ref={thumbRef}
        style={{left: `${RANGE_THUMB_RADIUS}px`}}
      />
      <input
        aria-label={ariaLabel}
        className={inputClassName}
        defaultValue={initialPosition}
        disabled={!playback.trackId}
        max={duration}
        min="0"
        onBlur={() => {
          draggingRef.current = false;
        }}
        onChange={event => {
          const position = clampProgressPosition(
            Number(event.target.value),
            duration,
          );
          const container = containerRef.current;
          const fill = fillRef.current;
          const thumb = thumbRef.current;
          if (container && fill && thumb) {
            updateProgressFill(container, fill, thumb, position / duration);
          }
          seekRef.current(position);
        }}
        onKeyDown={() => {
          draggingRef.current = true;
        }}
        onKeyUp={() => {
          draggingRef.current = false;
        }}
        onPointerDown={() => {
          draggingRef.current = true;
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        ref={inputRef}
        step="0.1"
        type="range"
      />
    </div>
  );
}
