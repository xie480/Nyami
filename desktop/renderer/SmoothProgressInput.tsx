import {useEffect, useRef} from 'react';
import type {CSSProperties, RefObject} from 'react';
import type {PlaybackSnapshot} from '../shared/types';

type SmoothProgressInputProps = {
  ariaLabel: string;
  audioElementRef: RefObject<HTMLAudioElement | null>;
  className?: string;
  onSeek: (position: number) => void;
  playback: PlaybackSnapshot;
};

/** 使用音频元素的当前时间驱动进度控件，避免等待 IPC 状态刷新造成跳帧。 */
export function SmoothProgressInput({
  ariaLabel,
  audioElementRef,
  className,
  onSeek,
  playback,
}: SmoothProgressInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const playbackRef = useRef(playback);
  const seekRef = useRef(onSeek);
  const draggingRef = useRef(false);
  const duration = Math.max(1, playback.duration);

  playbackRef.current = playback;
  seekRef.current = onSeek;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    draggingRef.current = false;
    input.value = String(Math.max(0, playback.position));
  }, [playback.trackId]);

  useEffect(() => {
    if (playback.state === 'playing') {
      return;
    }
    const input = inputRef.current;
    if (!input || draggingRef.current) {
      return;
    }
    const position = Math.min(
      duration,
      Math.max(0, Number.isFinite(playback.position) ? playback.position : 0),
    );
    input.value = String(position);
    input.style.setProperty(
      '--range-progress',
      `${Math.round((position / duration) * 100)}%`,
    );
  }, [duration, playback.position, playback.state]);

  useEffect(() => {
    if (playback.state !== 'playing') {
      return;
    }
    let frame = 0;

    /** 在每个浏览器动画帧同步圆形滑块和已播放轨道。 */
    const renderFrame = (): void => {
      const input = inputRef.current;
      const snapshot = playbackRef.current;
      if (input) {
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
        const position = Math.min(
          duration,
          Math.max(0, Number.isFinite(manualPosition) ? manualPosition : 0),
        );
        if (!draggingRef.current) {
          input.value = String(position);
        }
        input.style.setProperty(
          '--range-progress',
          `${Math.round((position / duration) * 100)}%`,
        );
      }
      frame = window.requestAnimationFrame(renderFrame);
    };

    frame = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(frame);
  }, [audioElementRef, playback.state, playback.trackId]);

  const initialProgress = Math.round(
    (Math.min(duration, Math.max(0, playback.position)) / duration) * 100,
  );

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      defaultValue={Math.min(duration, Math.max(0, playback.position))}
      disabled={!playback.trackId}
      max={duration}
      min="0"
      onBlur={() => {
        draggingRef.current = false;
      }}
      onChange={event => {
        seekRef.current(Number(event.target.value));
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
      style={{
        '--range-progress': `${initialProgress}%`,
      } as CSSProperties}
      type="range"
    />
  );
}
