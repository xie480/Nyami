import React, { useEffect, useState, useCallback } from 'react';
import {
  View, SectionList, RefreshControl, StyleSheet, TouchableOpacity, Text, StatusBar, Alert,
} from 'react-native';
import { Header } from '../components/Header';
import { ListItem } from '../components/ListItem';
import { IconButton } from '../components/IconButton';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { favoriteService } from '../services';
import { importedPlaylistService } from '../services/importedPlaylistService';
import { useImportedPlaylistStore } from '../store/importedPlaylistStore';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FavoriteFolder, ImportedPlaylist } from '../types/domain';

type PreferenceItem =
  | { key: string; kind: 'owned'; folder: FavoriteFolder }
  | { key: string; kind: 'imported'; source: ImportedPlaylist };

interface PreferenceSection {
  title: string;
  data: PreferenceItem[];
}

const EMPTY_IMPORTED_SOURCES: ImportedPlaylist[] = [];
const EMPTY_VISIBLE_SOURCE_KEYS: string[] = [];

export const VisibleFoldersScreen = ({ navigation }: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const uid = useAuthStore((s) => s.userId);
  const hiddenFolderIds = useSettingsStore((s) => s.hiddenFolderIds);
  const setHiddenFolderIds = useSettingsStore((s) => s.setHiddenFolderIds);
  const importedSources = useImportedPlaylistStore(s =>
    uid
      ? s.catalogByUid[uid] ?? EMPTY_IMPORTED_SOURCES
      : EMPTY_IMPORTED_SOURCES,
  );
  const visibleSourceKeys = useImportedPlaylistStore(s =>
    uid
      ? s.visibleSourceKeysByUid[uid] ?? EMPTY_VISIBLE_SOURCE_KEYS
      : EMPTY_VISIBLE_SOURCE_KEYS,
  );
  const setImportedCatalog = useImportedPlaylistStore((s) => s.setCatalog);
  const setVisibleSourceKeys = useImportedPlaylistStore((s) => s.setVisibleSourceKeys);

  const [folders, setFolders] = useState<FavoriteFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 本地编辑中的隐藏集合（退出时保存）
  const [localHidden, setLocalHidden] = useState<Set<number>>(new Set(hiddenFolderIds));
  const [localVisibleSources, setLocalVisibleSources] = useState<Set<string>>(new Set(visibleSourceKeys));

  const load = useCallback(async (force = false) => {
    if (!uid) return;
    setError(null);
    setSourceError(null);
    try {
      const data = await favoriteService.getFolders(uid, force);
      setFolders(data);
    } catch (e: any) {
      setError(e.message || '加载失败');
    }
    try {
      const sources = await importedPlaylistService.getCollectedPlaylists(uid, force);
      setImportedCatalog(uid, sources);
    } catch (e: any) {
      setSourceError(e.message || '外部收藏来源同步失败');
    }
    setRefreshing(false);
  }, [uid, setImportedCatalog]);

  useEffect(() => { load(); }, [load]);

  // 同步外部 hiddenFolderIds 到本地编辑状态
  useEffect(() => {
    setLocalHidden(new Set(hiddenFolderIds));
  }, [hiddenFolderIds]);

  useEffect(() => {
    setLocalVisibleSources(new Set(visibleSourceKeys));
  }, [visibleSourceKeys]);

  const toggleFolder = (id: number) => {
    setLocalHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isFolderVisible = (id: number) => !localHidden.has(id);
  const isSourceVisible = (sourceKey: string) => localVisibleSources.has(sourceKey);

  const preferenceItems: PreferenceItem[] = [
    ...(folders ?? []).map(folder => ({
      key: `ownedFavorite:${folder.id}`,
      kind: 'owned' as const,
      folder,
    })),
    ...importedSources.map(source => ({
      key: source.sourceKey,
      kind: 'imported' as const,
      source,
    })),
  ];
  const ownedItems = preferenceItems.filter(item => item.kind === 'owned');
  const followedItems = preferenceItems.filter(
    item => item.kind === 'imported',
  );
  const preferenceSections: PreferenceSection[] = [
    ...(ownedItems.length > 0
      ? [{title: '我创建的收藏夹', data: ownedItems}]
      : []),
    ...(followedItems.length > 0
      ? [{title: '我追的合集/收藏夹', data: followedItems}]
      : []),
  ];

  const isItemVisible = (item: PreferenceItem) =>
    item.kind === 'owned'
      ? isFolderVisible(item.folder.id)
      : isSourceVisible(item.source.sourceKey);

  const onSave = () => {
    setHiddenFolderIds(Array.from(localHidden));
    if (uid) setVisibleSourceKeys(uid, Array.from(localVisibleSources));
    navigation.goBack();
  };

  const onSelectAll = () => {
    // 全选：清空隐藏列表
    setLocalHidden(new Set());
    setLocalVisibleSources(new Set(importedSources.map(source => source.sourceKey)));
  };

  const onDeselectAll = () => {
    // 反选：隐藏所有收藏夹
    if (folders) {
      setLocalHidden(new Set(folders.map(f => f.id)));
    }
    setLocalVisibleSources(new Set());
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    list: { padding: t.spacing.lg, gap: t.spacing.md },
    toolbar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
      backgroundColor: t.colors.surface,
      borderBottomWidth: 0.5,
      borderColor: t.colors.divider,
    },
    sectionHeader: {
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.xs,
      backgroundColor: t.colors.background,
    },
    sectionTitle: {
      color: t.colors.text,
      fontSize: t.fontSize.md,
      fontWeight: '600',
    },
  });

  return (
    <View style={s.container}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header
        title="主页播放列表偏好"
        showBack
        right={preferenceItems.length > 0 && (
          <TouchableOpacity onPress={onSave}>
            <Text style={{ color: t.colors.primary, fontSize: t.fontSize.base, fontWeight: '600' }}>保存</Text>
          </TouchableOpacity>
        )}
      />
      {folders === null && !error ? (
        <Loading />
      ) : error && preferenceItems.length === 0 ? (
        <ErrorView message={error} onRetry={() => load(true)} />
      ) : sourceError && preferenceItems.length === 0 ? (
        <ErrorView
          message={`外部收藏来源同步失败：${sourceError}`}
          onRetry={() => load(true)}
        />
      ) : preferenceItems.length === 0 ? (
        <Empty title="没有可选择的播放列表" hint="登录 B 站后会自动导入已收藏的他人收藏夹和订阅合集" />
      ) : (
        <>
          <View style={s.toolbar}>
            <TouchableOpacity onPress={onSelectAll}>
              <Text style={{ color: t.colors.primary, fontSize: t.fontSize.sm }}>全选</Text>
            </TouchableOpacity>
            <Text style={{ color: t.colors.textSub, fontSize: t.fontSize.sm }}>
              已选 {preferenceItems.filter(isItemVisible).length}/{preferenceItems.length} 个
            </Text>
            <TouchableOpacity onPress={onDeselectAll}>
              <Text style={{ color: t.colors.error, fontSize: t.fontSize.sm }}>反选</Text>
            </TouchableOpacity>
          </View>
          {sourceError && (
            <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.xs, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
              外部来源同步失败，保留上次目录：{sourceError}
            </Text>
          )}
          {error && (
            <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.xs, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
              自有收藏夹读取失败：{error}
            </Text>
          )}
          <SectionList
            contentContainerStyle={s.list}
            sections={preferenceSections}
            showsVerticalScrollIndicator={false}
            keyExtractor={(it) => it.key}
            extraData={{ localHidden, localVisibleSources }}
            renderSectionHeader={({section}) => (
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>{section.title}</Text>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={{ height: t.spacing.md }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={t.colors.primary} />
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  if (item.kind === 'owned') {
                    toggleFolder(item.folder.id);
                  } else {
                    setLocalVisibleSources(previous => {
                      const next = new Set(previous);
                      if (next.has(item.source.sourceKey)) next.delete(item.source.sourceKey);
                      else next.add(item.source.sourceKey);
                      return next;
                    });
                  }
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: t.spacing.md,
                  paddingHorizontal: t.spacing.lg,
                  backgroundColor: t.colors.surface,
                  borderRadius: t.radius.md,
                }}
              >
                <IconButton
                  name={isItemVisible(item) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={isItemVisible(item) ? t.colors.primary : t.colors.textHint}
                />
                <View style={{ flex: 1, marginLeft: t.spacing.md }}>
                  <ListItem
                    title={item.kind === 'owned' ? item.folder.title : item.source.title}
                    subtitle={item.kind === 'owned'
                      ? `${item.folder.mediaCount} 个视频 · 我的收藏夹`
                      : `${item.source.ownerName || `UP主 UID ${item.source.ownerMid}`} · ${item.source.mediaCount} 个视频 · ${item.source.kind === 'subscribedSeason' ? '订阅合集' : '他人收藏夹'}`}
                    icon={item.kind === 'owned'
                      ? 'folder-music-outline'
                      : item.source.kind === 'subscribedSeason' ? 'view-grid-outline' : 'folder-heart-outline'}
                    showArrow={false}
                  />
                </View>
              </TouchableOpacity>
            )}
          />
        </>
      )}
    </View>
  );
};
