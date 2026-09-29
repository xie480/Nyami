import React, { useEffect, useState, useCallback } from 'react';
import {
  View, SectionList, RefreshControl, StyleSheet, TouchableOpacity, Text, StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Header } from '../components/Header';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { favoriteService } from '../services';
import {resolveFavoriteFolderId} from '../services/favoriteService';
import { importedPlaylistService } from '../services/importedPlaylistService';
import { useImportedPlaylistStore } from '../store/importedPlaylistStore';
import { useTheme } from '../theme';
import type { FavoriteFolder, ImportedPlaylist } from '../types/domain';
import {queueIndexSyncWithRetry} from '../store/syncStore';

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
    const nextHiddenFolderIds = Array.from(localHidden).map(folderId =>
      uid ? resolveFavoriteFolderId(uid, folderId) : folderId,
    );
    const newlyVisibleSource = Array.from(localVisibleSources).some(
      sourceKey => !visibleSourceKeys.includes(sourceKey),
    );
    setHiddenFolderIds(nextHiddenFolderIds);
    if (uid) {
      setVisibleSourceKeys(uid, Array.from(localVisibleSources));
      if (newlyVisibleSource) queueIndexSyncWithRetry(uid, nextHiddenFolderIds);
    }
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.xs,
      backgroundColor: t.colors.background,
      marginTop: t.spacing.sm,
    },
    sectionTitle: {
      color: t.colors.text,
      fontSize: t.fontSize.md,
      fontWeight: '600',
    },
    sectionCount: {
      color: t.colors.textHint,
      fontSize: t.fontSize.xs,
      paddingHorizontal: t.spacing.sm,
      paddingVertical: 2,
      borderRadius: t.radius.sm,
      backgroundColor: t.colors.surfaceHigh,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 76,
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.md,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.divider,
    },
    cardSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primaryLight,
    },
    iconBox: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.md,
      backgroundColor: t.colors.surfaceHigh,
    },
    cardContent: {
      flex: 1,
      minWidth: 0,
      marginLeft: t.spacing.md,
    },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    cardTitle: {
      flex: 1,
      flexShrink: 1,
      color: t.colors.text,
      fontSize: t.fontSize.base,
      fontWeight: '600',
    },
    kindBadge: {
      marginLeft: t.spacing.sm,
      paddingHorizontal: t.spacing.sm,
      paddingVertical: 3,
      borderRadius: t.radius.sm,
      backgroundColor: t.colors.surfaceHigh,
    },
    kindBadgeText: {
      color: t.colors.textSub,
      fontSize: t.fontSize.xs,
    },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: t.spacing.xs,
    },
    ownerName: {
      flex: 1,
      flexShrink: 1,
      color: t.colors.textSub,
      fontSize: t.fontSize.sm,
    },
    videoCount: {
      color: t.colors.textHint,
      fontSize: t.fontSize.xs,
      marginLeft: t.spacing.sm,
    },
    videoCountLeading: {
      marginLeft: 0,
    },
    selectionIcon: {
      marginLeft: t.spacing.md,
    },
  });

  const renderPreferenceItem = ({ item }: { item: PreferenceItem }) => {
    const isVisible = isItemVisible(item);
    const title = item.kind === 'owned' ? item.folder.title : item.source.title;
    const kindLabel = item.kind === 'owned'
      ? '我的收藏夹'
      : item.source.kind === 'subscribedSeason' ? '订阅合集' : '他人收藏夹';
    const iconName = item.kind === 'owned'
      ? 'folder-music-outline'
      : item.source.kind === 'subscribedSeason' ? 'view-grid-outline' : 'folder-heart-outline';
    const ownerName = item.kind === 'imported'
      ? item.source.ownerName || `UP主 UID ${item.source.ownerMid}`
      : null;
    const mediaCount = item.kind === 'owned' ? item.folder.mediaCount : item.source.mediaCount;

    return (
      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityLabel={`${title}，${kindLabel}`}
        accessibilityState={{ checked: isVisible }}
        activeOpacity={0.82}
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
        style={[s.card, isVisible && s.cardSelected]}
      >
        <View style={s.iconBox}>
          <Icon name={iconName} size={23} color={isVisible ? t.colors.primary : t.colors.textSub} />
        </View>
        <View style={s.cardContent}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle} numberOfLines={1}>{title}</Text>
            <View style={s.kindBadge}>
              <Text style={s.kindBadgeText} numberOfLines={1}>{kindLabel}</Text>
            </View>
          </View>
          <View style={s.cardMeta}>
            {ownerName && <Text style={s.ownerName} numberOfLines={1}>{ownerName}</Text>}
            <Text style={[s.videoCount, !ownerName && s.videoCountLeading]}>{mediaCount} 个视频</Text>
          </View>
        </View>
        <Icon
          name={isVisible ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={23}
          color={isVisible ? t.colors.primary : t.colors.textHint}
          style={s.selectionIcon}
        />
      </TouchableOpacity>
    );
  };

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
                <Text style={s.sectionCount}>{section.data.length}</Text>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={{ height: t.spacing.md }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={t.colors.primary} />
            }
            renderItem={renderPreferenceItem}
          />
        </>
      )}
    </View>
  );
};
