import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Platform, Text, ToastAndroid, TouchableOpacity} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type {ImportedPlaylist} from '../types/domain';
import {useAuthStore} from '../store/authStore';
import {useImportedPlaylistStore} from '../store/importedPlaylistStore';
import {useSettingsStore} from '../store/settingsStore';
import {queueIndexSyncWithRetry} from '../store/syncStore';
import {useTheme} from '../theme';

const EMPTY_SOURCE_KEYS: string[] = [];

function notify(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.LONG);
  } else {
    Alert.alert('收藏夹同步', message);
  }
}

/** 将已经在 B 站收藏/订阅的来源加入本机收藏夹，并触发增量索引与标签同步。 */
export const SubscribePlaylistButton = ({
  source,
  compact = false,
}: {
  source: ImportedPlaylist;
  compact?: boolean;
}) => {
  const t = useTheme();
  const uid = useAuthStore(state => state.userId);
  const hiddenFolderIds = useSettingsStore(state => state.hiddenFolderIds);
  const visibleSourceKeys = useImportedPlaylistStore(state =>
    uid ? state.visibleSourceKeysByUid[uid] ?? EMPTY_SOURCE_KEYS : EMPTY_SOURCE_KEYS,
  );
  const setCatalog = useImportedPlaylistStore(state => state.setCatalog);
  const setVisibleSourceKeys = useImportedPlaylistStore(state => state.setVisibleSourceKeys);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const subscribed = visibleSourceKeys.includes(source.sourceKey);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onSubscribe = async () => {
    if (!uid || submitting || subscribed) return;
    const importedStore = useImportedPlaylistStore.getState();
    const catalog = importedStore.catalogByUid[uid] ?? [];
    const currentVisibleSourceKeys = importedStore.visibleSourceKeysByUid[uid] ?? [];
    if (currentVisibleSourceKeys.includes(source.sourceKey)) return;
    setSubmitting(true);
    if (!catalog.some(item => item.sourceKey === source.sourceKey)) {
      const catalogEntry: ImportedPlaylist = {
        sourceKey: source.sourceKey,
        kind: source.kind,
        remoteId: source.remoteId,
        ownerMid: source.ownerMid,
        ownerName: source.ownerName,
        title: source.title,
        cover: source.cover,
        mediaCount: source.mediaCount,
        description: source.description,
      };
      setCatalog(uid, [...catalog, catalogEntry]);
    }
    if (!currentVisibleSourceKeys.includes(source.sourceKey)) {
      setVisibleSourceKeys(uid, [...currentVisibleSourceKeys, source.sourceKey]);
    }

    try {
      queueIndexSyncWithRetry(uid, hiddenFolderIds);
      notify('已加入本机收藏夹，视频索引正在后台同步；失败后会自动重试。');
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const backgroundColor = subscribed ? t.colors.surfaceHigh : t.colors.primary;
  const foregroundColor = subscribed ? t.colors.textSub : t.colors.onPrimary;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={subscribed ? `${source.title} 已订阅并加入收藏夹` : `订阅 ${source.title} 并同步到收藏夹`}
      accessibilityState={{disabled: !uid || subscribed || submitting}}
      disabled={!uid || subscribed || submitting}
      onPress={() => void onSubscribe()}
      activeOpacity={0.78}
      style={{
        minHeight: compact ? 32 : 38,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: compact ? 10 : 14,
        borderRadius: 19,
        backgroundColor,
        opacity: submitting ? 0.78 : 1,
      }}>
      {submitting ? (
        <ActivityIndicator size="small" color={foregroundColor} />
      ) : (
        <Icon name={subscribed ? 'check' : 'plus'} size={compact ? 15 : 17} color={foregroundColor} />
      )}
      <Text style={{fontSize: compact ? t.fontSize.xs : t.fontSize.sm, color: foregroundColor, fontWeight: '700', marginLeft: 5}}>
        {subscribed ? '已订阅' : '订阅'}
      </Text>
    </TouchableOpacity>
  );
};
