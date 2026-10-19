import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Alert, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LoggerService from '../services/LoggerService';
import { Header } from '../components/Header';
import { useTheme } from '../theme';
import { favoriteService } from '../services/favoriteService';
import { getAllPlaylistMeta } from '../db/operations';
import { useAuthStore } from '../store/authStore';
import type { FavoriteFolder } from '../types/domain';
import type { PlaylistMeta } from '../db/models/PlaylistMeta';
import { IconButton } from '../components/IconButton';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import {useNetworkRecoveryRefresh} from '../hooks/useNetworkRecoveryRefresh';

interface FolderSyncInfo {
  folder: FavoriteFolder;
  meta: PlaylistMeta | null;
}

/** 根据 PlaylistMeta 的状态生成显示文字和颜色 */
function getSyncStatusDisplay(meta: PlaylistMeta | null) {
  if (!meta) {
    return { text: '未同步', color: 'textSub' as const };
  }
  switch (meta.playlistSyncStatus) {
    case 'syncing':
      return { text: `同步中 (${meta.localSyncedCount}/${meta.remoteVideoCount})`, color: 'primary' as const };
    case 'success':
      if (meta.needResync) {
        return { text: `需重新同步 (${meta.localSyncedCount}/${meta.remoteVideoCount})`, color: 'warning' as const };
      }
      return { text: `已同步 (${meta.localSyncedCount}/${meta.remoteVideoCount})`, color: 'primary' as const };
    case 'failed':
      return { text: '同步失败', color: 'error' as const };
    case 'running':
      return { text: '中断（上次同步未完成）', color: 'warning' as const };
    default:
      return { text: `待同步 (${meta.localSyncedCount}/${meta.remoteVideoCount})`, color: 'textSub' as const };
  }
}

export const SyncDetailsScreen = () => {
  const t = useTheme();
  const uid = useAuthStore((s) => s.userId);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [foldersInfo, setFoldersInfo] = useState<FolderSyncInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  const loadData = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const folders = await favoriteService.getFolders(uid);
      const playlistMetas = await getAllPlaylistMeta();
      const metaMap = new Map<string, PlaylistMeta>();
      for (const meta of playlistMetas) {
        metaMap.set(meta.playlistId, meta);
      }

      const info = folders.map(f => ({
        folder: f,
        meta: metaMap.get(f.id.toString()) || null,
      }));
      setFoldersInfo(info);
    } catch (e) {
      setLoadFailed(true);
      LoggerService.error('SyncDetailsScreen', 'loadData', 'Failed to load sync details', e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useNetworkRecoveryRefresh(loadData, Boolean(uid && loadFailed));

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDelete = async (ids: number[]) => {
    Alert.alert(
      '确认删除',
      `确定要删除选中的 ${ids.length} 个收藏夹的索引数据吗？\n这不会删除B站上的实际收藏夹。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              for (const id of ids) {
                await favoriteService.deleteFolderIndex(id);
              }
              setSelectedIds(new Set());
              setIsMultiSelectMode(false);
              await loadData();
            } catch (e) {
              LoggerService.error('SyncDetailsScreen', 'handleDelete', 'Failed to delete folder index', e);
              Alert.alert('错误', '删除失败');
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: FolderSyncInfo }) => {
    const { folder, meta } = item;
    const isSelected = selectedIds.has(folder.id);
    const status = getSyncStatusDisplay(meta);
    const statusColor = t.colors[status.color];

    return (
      <View style={[styles.itemContainer, {backgroundColor: isSelected ? t.colors.primaryLight : t.colors.surface, borderColor: isSelected ? t.colors.primary : t.colors.divider}]}>
        <TouchableOpacity
          accessible={isMultiSelectMode}
          accessibilityRole={isMultiSelectMode ? 'checkbox' : undefined}
          accessibilityLabel={isMultiSelectMode ? `${folder.title}，${status.text}，选择删除索引` : undefined}
          accessibilityState={isMultiSelectMode ? {checked: isSelected} : undefined}
          disabled={!isMultiSelectMode}
          activeOpacity={0.76}
          onPress={() => toggleSelect(folder.id)}
          style={styles.selectionArea}>
        <Icon name={isMultiSelectMode ? isSelected ? 'check-circle' : 'checkbox-blank-circle-outline' : 'folder-sync-outline'} size={26} color={isSelected ? t.colors.primary : t.colors.textSub} style={{marginRight: t.spacing.md}} />
        <View style={styles.itemContent}>
          <Text style={[styles.title, { color: t.colors.text }]} numberOfLines={2}>
            {folder.title}
          </Text>
          <Text style={[styles.subtitle, { color: statusColor }]}>
            {status.text}
          </Text>
          {meta && meta.remoteVideoCount > 0 && (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${folder.title}索引同步进度`}
              accessibilityValue={{min: 0, max: meta.remoteVideoCount, now: Math.min(meta.remoteVideoCount, Math.max(0, meta.localSyncedCount))}}
              style={styles.progressTrack}>
              <View style={[styles.progressFill, {width: `${Math.min(100, Math.max(0, meta.localSyncedCount / meta.remoteVideoCount * 100))}%`, backgroundColor: statusColor}]} />
            </View>
          )}
        </View>
        </TouchableOpacity>
        {!isMultiSelectMode && meta && (
          <IconButton
            name="delete-outline"
            accessibilityLabel={`删除 ${folder.title} 的本地索引`}
            size={24}
            color={t.colors.error}
            onPress={() => handleDelete([folder.id])}
          />
        )}
      </View>
    );
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    list: { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.lg, paddingBottom: t.spacing.xl },
    itemContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 88,
      paddingHorizontal: t.spacing.md,
      borderWidth: 1,
      borderRadius: t.radius.xl,
      marginBottom: t.spacing.md,
    },
    itemContent: { flex: 1, minWidth: 0 },
    title: { fontSize: t.fontSize.base, fontWeight: '600', marginBottom: 6 },
    subtitle: { fontSize: t.fontSize.sm, lineHeight: 21 },
    fill: {flex: 1},
    selectionArea: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.md},
    progressTrack: {height: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: t.colors.surfaceHigh, marginTop: t.spacing.sm},
    progressFill: {height: '100%', borderRadius: 2},
    intro: {padding: t.spacing.lg, marginBottom: t.spacing.lg, backgroundColor: t.colors.primaryLight, borderRadius: t.radius.xl},
    introTitle: {fontSize: t.fontSize.lg, fontWeight: '700', color: t.colors.text},
    introHint: {fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: t.spacing.sm, lineHeight: 21},
    footer: {
      flexDirection: 'row',
      padding: t.spacing.md,
      backgroundColor: t.colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.divider,
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: t.spacing.md,
    },
  });

  return (
    <View style={styles.container}>
      <Header
        title="同步详情"
        showBack
        right={
          <IconButton
            name={isMultiSelectMode ? 'close' : 'playlist-check'}
            accessibilityLabel={isMultiSelectMode ? '退出批量管理' : '批量管理同步索引'}
            size={24}
            onPress={() => {
              setIsMultiSelectMode(!isMultiSelectMode);
              setSelectedIds(new Set());
            }}
          />
        }
      />
      {!uid ? (
        <Empty title="登录后查看同步状态" hint="前往设置登录 B 站，同步收藏夹内容" />
      ) : loading ? (
        <Loading />
      ) : loadFailed && foldersInfo.length === 0 ? (
        <ErrorView message="同步详情加载失败，请重试" onRetry={loadData} />
      ) : foldersInfo.length === 0 ? (
        <Empty title="暂无收藏夹" />
      ) : (
        <>
          <FlatList
            style={styles.fill}
            data={foldersInfo}
            keyExtractor={item => item.folder.id.toString()}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            extraData={{selectedIds, isMultiSelectMode}}
            ListHeaderComponent={
              <View style={styles.intro}>
                <Text accessibilityRole="header" style={styles.introTitle}>收藏同步概览</Text>
                <Text style={styles.introHint}>
                  {foldersInfo.length} 个收藏夹 · {foldersInfo.filter(item => item.meta?.playlistSyncStatus === 'success' && !item.meta.needResync).length} 个已完成同步
                </Text>
                <Text style={styles.introHint}>这里管理本机索引，删除后可重新同步，B 站收藏内容会保留。</Text>
                {loadFailed && (
                  <>
                    <Text accessibilityRole="alert" style={{fontSize: t.fontSize.sm, color: t.colors.error, marginTop: t.spacing.sm}}>刷新失败，当前显示上次读取的状态</Text>
                    <Button title="重新加载" variant="text" onPress={loadData} />
                  </>
                )}
              </View>
            }
          />
          {isMultiSelectMode && (
            <View style={styles.footer}>
              <Text style={{ color: t.colors.text }}>
                已选择 {selectedIds.size} 项
              </Text>
              <Button
                title="删除所选索引"
                variant="primary"
                disabled={selectedIds.size === 0}
                onPress={() => handleDelete(Array.from(selectedIds))}
                style={{ backgroundColor: t.colors.error }}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
};
