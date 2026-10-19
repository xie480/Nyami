export const lightColors = {
  primary: '#6945DB',
  primaryDark: '#6243DE',
  primaryLight: '#EEE9FF',

  background: '#FAF9FD',
  surface: '#FFFFFF',
  surfaceHigh: '#F0EDF6',
  surfaceRaised: '#FFFFFF',
  surfacePressed: '#E9E3F8',
  overlay: 'rgba(18, 14, 32, 0.48)',

  text: '#18191C',
  textSub: '#61666D',
  textHint: '#656874',
  divider: '#E4E0EC',

  success: '#087452',
  warning: '#946200',
  error: '#C83248',
  onSuccess: '#FFFFFF',
  onWarning: '#FFFFFF',
  onError: '#FFFFFF',

  // 用于反色文字（如主色按钮上的文字）
  onPrimary: '#FFFFFF',
};

export const darkColors: typeof lightColors = {
  primary: '#B5A1FF',
  primaryDark: '#8069EE',
  primaryLight: '#29223F',

  background: '#101014',
  surface: '#1B1A22',
  surfaceHigh: '#292632',
  surfaceRaised: '#24212D',
  surfacePressed: '#393047',
  overlay: 'rgba(0, 0, 0, 0.64)',

  text: '#F1F2F3',
  textSub: '#B8B3C4',
  textHint: '#A09AAA',
  divider: '#383340',

  success: '#61D6AD',
  warning: '#F2C46D',
  error: '#FF8FA1',
  onSuccess: '#10281F',
  onWarning: '#2B200C',
  onError: '#350D16',

  onPrimary: '#201537',
};

export type Colors = typeof lightColors;
