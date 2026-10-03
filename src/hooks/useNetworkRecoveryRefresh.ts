import {useEffect, useRef} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {
  getNetworkRecoveryRevision,
  subscribeNetworkRecovered,
} from '../services/networkRecoveryService';

/** 只让当前聚焦页面在联网恢复后重试其已失败的数据加载。 */
export function useNetworkRecoveryRefresh(
  onRecover: () => unknown | Promise<unknown>,
  enabled: boolean,
) {
  const isFocused = useIsFocused();
  const callbackRef = useRef(onRecover);
  const lastHandledRevisionRef = useRef(getNetworkRecoveryRevision());
  callbackRef.current = onRecover;

  useEffect(() => {
    if (!enabled) return undefined;
    const retryForRevision = (revision: number) => {
      if (!isFocused || revision <= lastHandledRevisionRef.current) return undefined;
      lastHandledRevisionRef.current = revision;
      return Promise.resolve(callbackRef.current()).catch(() => {});
    };
    const unsubscribe = subscribeNetworkRecovered(retryForRevision);
    retryForRevision(getNetworkRecoveryRevision());
    return unsubscribe;
  }, [enabled, isFocused]);
}
