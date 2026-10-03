import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type NetType = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface NetStatusChange {
  type: NetType;
  previousType: NetType;
  isOnline: boolean | null;
  previousIsOnline: boolean | null;
}

class NetStatus {
  private _type: NetType = 'unknown';
  private _isOnline: boolean | null = null;
  private listeners = new Set<(t: NetType) => void>();
  private statusListeners = new Set<(change: NetStatusChange) => void>();
  private initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    NetInfo.addEventListener((s: NetInfoState) => {
      this.update(s);
    });
  }

  private update(s: NetInfoState) {
    const previousType = this._type;
    const previousIsOnline = this._isOnline;
    const isOffline = s.isConnected === false || s.isInternetReachable === false;
    const type: NetType = isOffline
      ? 'none'
      : s.type === 'wifi'
        ? 'wifi'
        : s.type === 'cellular'
          ? 'cellular'
          : 'unknown';
    const isOnline = s.isConnected === false
      ? false
      : s.isInternetReachable ?? s.isConnected;
    this._type = type;
    this._isOnline = isOnline;

    if (type !== previousType) {
      this.listeners.forEach(fn => fn(type));
    }
    if (type !== previousType || isOnline !== previousIsOnline) {
      const change: NetStatusChange = {
        type,
        previousType,
        isOnline,
        previousIsOnline,
      };
      this.statusListeners.forEach(fn => fn(change));
    }
  }

  async refresh() {
    this.update(await NetInfo.fetch());
  }

  get type() {
    return this._type;
  }
  get isOnline() {
    return this._isOnline ?? this._type !== 'none';
  }
  isWifi = () => this._type === 'wifi';
  isCellular = () => this._type === 'cellular';
  onChange(fn: (t: NetType) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onStatusChange(fn: (change: NetStatusChange) => void) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }
}

export const netStatus = new NetStatus();
