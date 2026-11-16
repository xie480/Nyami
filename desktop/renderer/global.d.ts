import type {NyamiDesktopApi} from '../shared/types';

declare global {
  interface Window {
    nyamiDesktop: NyamiDesktopApi;
  }
}

export {};
