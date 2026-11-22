import type {SVGProps} from 'react';

export type IconName =
  | 'alert'
  | 'arrow-left'
  | 'arrow-right'
  | 'bell'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'compass'
  | 'download'
  | 'folder'
  | 'heart'
  | 'home'
  | 'loader'
  | 'log-in'
  | 'log-out'
  | 'list'
  | 'maximize'
  | 'moon'
  | 'minus'
  | 'pause'
  | 'play'
  | 'plus'
  | 'refresh'
  | 'repeat'
  | 'shuffle'
  | 'restore'
  | 'search'
  | 'settings'
  | 'sparkles'
  | 'trash'
  | 'user'
  | 'volume'
  | 'x';

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

const paths: Record<IconName, JSX.Element> = {
  alert: (
    <>
      <path d="M12 3 2.8 19h18.4L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 16h.01" />
    </>
  ),
  'arrow-left': <path d="m15 18-6-6 6-6" />,
  'arrow-right': <path d="m9 18 6-6-6-6" />,
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.2 8.8-1.5 4.9-4.9 1.5 1.5-4.9 4.9-1.5Z" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.5h6l1.7 2H20a1 1 0 0 1 1 1v7.8a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 17.3V7.2a.7.7 0 0 1 .5-.7Z" />
      <path d="M3 10h18" />
    </>
  ),
  heart: (
    <path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.6Z" />
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  loader: (
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  ),
  'log-in': (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="M10 8l4 4-4 4" />
      <path d="M14 12H3" />
    </>
  ),
  'log-out': (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="m10 8-4 4 4 4" />
      <path d="M6 12h11" />
    </>
  ),
  list: (
    <>
      <path d="M5 6h14" />
      <path d="M5 12h14" />
      <path d="M5 18h14" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>
  ),
  maximize: <path d="M5 5h14v14H5Z" />,
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
  minus: <path d="M5 12h14" />,
  pause: (
    <>
      <path d="M9 5v14" />
      <path d="M15 5v14" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.8-4L3 10" />
      <path d="M3 4v6h6" />
      <path d="M4 13a8 8 0 0 0 14.8 4L21 14" />
      <path d="M21 20v-6h-6" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 4 20 7l-3 3" />
      <path d="M4 7h12a4 4 0 0 1 4 4v1" />
      <path d="m7 20-3-3 3-3" />
      <path d="M20 17H8a4 4 0 0 1-4-4v-1" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7h3c3.6 0 5.2 10 9 10h4" />
      <path d="m17 14 3 3-3 3" />
      <path d="M4 17h3c1.1 0 2-1 2.7-2.1" />
      <path d="M14.3 9.1C15 8 16 7 17 7h3" />
      <path d="m17 4 3 3-3 3" />
    </>
  ),
  restore: (
    <>
      <path d="M8 8h11v11H8Z" />
      <path d="M5 16V5h11" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.5 1.5-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.1v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.5-1.5.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H7v-2.1h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.5-1.5.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V5h2.1v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.5 1.5-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V13h-.2a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3Z" />
      <path d="m19 15 .6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M10 11v5M14 11v5" />
      <path d="m7 7 .8 13h8.4L17 7" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  volume: (
    <>
      <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
      <path d="M17 9.5a4 4 0 0 1 0 5" />
      <path d="M19.5 7a7.5 7.5 0 0 1 0 10" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
};

/** 渲染统一线性图标，保证导航和控制图标的视觉风格一致。 */
export function Icon({name, size = 18, ...props}: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}>
      {paths[name]}
    </svg>
  );
}
