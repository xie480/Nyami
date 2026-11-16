import type {KeyValueStore} from '../../../packages/platform-contracts/src';
import {storage} from '../../core/storage';

/** 将 MMKV 包装为共享核心使用的同步键值存储。 */
export const mobileKeyValueStore: KeyValueStore = {
  /** 读取字符串值。 */
  getString(key: string) {
    return storage.getString(key) ?? null;
  },

  /** 写入字符串值。 */
  setString(key: string, value: string) {
    storage.setString(key, value);
  },

  /** 删除键值。 */
  delete(key: string) {
    storage.delete(key);
  },

  /** 判断键值是否存在。 */
  contains(key: string) {
    return storage.contains(key);
  },
};
