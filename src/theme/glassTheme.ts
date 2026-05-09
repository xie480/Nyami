export interface ShadowLayer {
  offsetY: number;
  blur: number;
  color: string;
}

export interface OrbConfig {
  color: string;
  opacity: number;
  blurRadius: number;
  position: { x: string; y: string };
  animDuration: number;
  animDelay: number;
}

export interface ShardConfig {
  bg: string;
  borderColor: string;
  glowColor: string;
  rotation: number;
  animDuration: number;
  animDelay: number;
}

export interface GlassTheme {
  id: 'light' | 'dark';
  colors: {
    pageBg: string | string[];
    glass: {
      bg: string;
      border: string;
      highlightInner: string;
      shimmerEdge: string;
    };
    player?: {
      bgOverlay: string;
    };
    accent: {
      primary: string;
      secondary: string;
      tertiary: string;
    };
    text: {
      primary: string;
      secondary: string;
      tertiary: string;
    };
    progress: {
      trackBg: string;
      fill: string[];
      glowColor: string;
    };
    button: {
      secondaryBg: string;
      secondaryShadow: string;
      playBg: string | string[];
      playText: string;
    };
  };
  material: {
    blurRadius: number;
    playerBlurRadius?: number;
    shadowLayers: ShadowLayer[];
    backgroundOrbs: OrbConfig[];
    floatingShards: ShardConfig[];
  };
  motion: {
    hoverLift: number;
    pulseColor: string;
    floatDuration: [number, number];
  };
}

export const GlassLightTheme: GlassTheme = {
  id: 'light',
  colors: {
    pageBg: ['#f8f5ff', '#fef7fa', '#f5f0ff', '#faf5f9', '#f3f0fc'],
    glass: {
      bg: 'rgba(255, 255, 255, 0.45)',
      border: 'rgba(255, 255, 255, 0.55)',
      highlightInner: 'rgba(255, 255, 255, 0.7)',
      shimmerEdge: 'rgba(255, 255, 255, 0.7)'
    },
    player: {
      bgOverlay: 'rgba(255, 255, 255, 0.12)'
    },
    accent: {
      primary: '#6c5ce7',
      secondary: '#e879a0',
      tertiary: '#5b9cf5'
    },
    text: {
      primary: '#1a1a2e',
      secondary: '#5a5a7a',
      tertiary: '#8a8aa0'
    },
    progress: {
      trackBg: 'rgba(0, 0, 0, 0.08)',
      fill: ['#6c5ce7', '#e879a0'],
      glowColor: 'rgba(108, 92, 231, 0.35)'
    },
    button: {
      secondaryBg: 'rgba(255, 255, 255, 0.5)',
      secondaryShadow: 'rgba(0, 0, 0, 0.06)',
      playBg: '#1a1a2e',
      playText: '#ffffff'
    }
  },
  material: {
    blurRadius: 16,
    playerBlurRadius: 18,
    shadowLayers: [
      { offsetY: 8, blur: 40, color: 'rgba(0, 0, 0, 0.08)' },
      { offsetY: 2, blur: 8,  color: 'rgba(0, 0, 0, 0.04)' }
    ],
    backgroundOrbs: [
      { color: '#b496f0', opacity: 0.55, blurRadius: 80, position: { x: '-8%', y: '-15%' }, animDuration: 14, animDelay: 0 },
      { color: '#f08caa', opacity: 0.50, blurRadius: 80, position: { x: '90%', y: '55%' },  animDuration: 16, animDelay: -4 },
      { color: '#64aaf0', opacity: 0.45, blurRadius: 80, position: { x: '25%', y: '88%' },  animDuration: 13, animDelay: -8 },
      { color: '#c8a0dc', opacity: 0.40, blurRadius: 80, position: { x: '50%', y: '30%' },  animDuration: 15, animDelay: -2 }
    ],
    floatingShards: [
      { bg: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.4)', glowColor: 'rgba(0,0,0,0.04)', rotation: -15, animDuration: 11, animDelay: 0 },
      { bg: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.4)', glowColor: 'rgba(0,0,0,0.04)', rotation: 20,  animDuration: 12, animDelay: -5 },
      { bg: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.4)', glowColor: 'rgba(0,0,0,0.04)', rotation: 8,   animDuration: 9,  animDelay: -3 }
    ]
  },
  motion: {
    hoverLift: 4,
    pulseColor: 'rgba(108, 92, 231, 0.3)',
    floatDuration: [12, 16]
  }
};

export const GlassDarkTheme: GlassTheme = {
  id: 'dark',
  colors: {
    pageBg: ['#040404', '#08080c', '#060608'],
    glass: {
      bg: 'rgba(18, 18, 24, 0.48)',
      border: 'rgba(255, 255, 255, 0.06)',
      highlightInner: 'rgba(255, 255, 255, 0.14)',
      shimmerEdge: 'rgba(255, 255, 255, 0.18)'
    },
    player: {
      bgOverlay: 'rgba(5, 5, 10, 0.20)'
    },
    accent: {
      primary: '#b44dff',
      secondary: '#00e5ff',
      tertiary: '#4da6ff'
    },
    text: {
      primary: '#f0f0f5',
      secondary: '#b0b0c8',
      tertiary: '#787898'
    },
    progress: {
      trackBg: 'rgba(255, 255, 255, 0.06)',
      fill: ['#00e5ff', '#b44dff'],
      glowColor: 'rgba(0, 229, 255, 0.4)'
    },
    button: {
      secondaryBg: 'rgba(255, 255, 255, 0.04)',
      secondaryShadow: 'rgba(0, 0, 0, 0.65)',
      playBg: ['#00e5ff', '#b44dff'],
      playText: '#0a0a14'
    }
  },
  material: {
    blurRadius: 64,
    playerBlurRadius: 28,
    shadowLayers: [
      { offsetY: 18, blur: 56, color: 'rgba(0, 0, 0, 0.85)' },
      { offsetY: 6, blur: 24,  color: 'rgba(0, 0, 0, 0.65)' },
      { offsetY: 1, blur: 6,   color: 'rgba(0, 0, 0, 0.45)' }
    ],
    backgroundOrbs: [],
    floatingShards: []
  },
  motion: {
    hoverLift: 4,
    pulseColor: 'rgba(0, 229, 255, 0.35)',
    floatDuration: [16, 24]
  }
};
