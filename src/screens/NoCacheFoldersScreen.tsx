import React, { useEffect, useState, useCallback } from 'react';
import {
  View, FlatList, RefreshControl, StyleSheet, TouchableOpacity, Text, StatusBar,
} from 'react-native';
import { Header } from '../components/Header';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { favoriteService } from '../services';
import {resolveFavoriteFolderId} from '../services/favoriteService';
import { useTheme } from '../theme';
import type { FavoriteFolder } from '../types/domain';
import {useNetworkRecoveryRefresh} from '../hooks/useNetworkRecoveryRefresh';

export const NoCacheFoldersScreen = ({ navigation }: any) => {
  const t = useTheme();
  const uid = useAuthStore((s) => s.userId);
  const noCacheFolderIds = useSettingsStore((s) => s.noCacheFolderIds);
  const setNoCacheFolderIds = useSettingsStore((s) => s.setNoCacheFolderIds);

  const [folders, setFolders] = useState<FavoriteFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 本地编辑中的无缓存集合（退出时保存）
  const [localNoCache, setLocalNoCache] = useState<Set<number>>(new Set(noCacheFolderIds));

  const load = useCallback(async (force = false) => {
    if (!uid) return;
    setError(null);
    try {
      const data = await favoriteService.getFolders(uid, force);
      setFolders(data);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setRefreshing(false);
    }
  }, [uid]);

  useNetworkRecoveryRefresh(() => {
    setRefreshing(true);
    return load(true);
  }, Boolean(uid && error));

  useEffect(() => { load(); }, [load]);

  // 同步外部 noCacheFolderIds 到本地编辑状态
  useEffect(() => {
    setLocalNoCache(new Set(noCacheFolderIds));
  }, [noCacheFolderIds]);

  const toggleFolder = (id: number) => {
    setLocalNoCache(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isFolderNoCache = (id: number) => localNoCache.has(id);

  const onSave = () => {
    setNoCacheFolderIds(Array.from(localNoCache).map(folderId =>
      uid ? resolveFavoriteFolderId(uid, folderId) : folderId,
    ).filter(folderId => folderId > 0));
    navigation.goBack();
  };

  const onSelectAll = () => {
    // 全选：所有收藏夹都无缓存
    if (folders) {
      setLocalNoCache(new Set(folders.map(f => f.id)));
    }
  };

  const onDeselectAll = () => {
    // 反选：清空无缓存列表
    setLocalNoCache(new Set());
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    list: { padding: t.spacing.lg, paddingBottom: t.spacing.xl },
    toolbar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
      padding: t.spacing.sm,
      marginBottom: t.spacing.lg,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.xl,
    },
    fill: {flex: 1},
    saveButton: {minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center'},
    saveText: {color: t.colors.primary, fontSize: t.fontSize.base, fontWeight: '600'},
    intro: {padding: t.spacing.lg, backgroundColor: t.colors.primaryLight, borderRadius: t.radius.xl, marginBottom: t.spacing.lg},
    introTitle: {fontSize: t.fontSize.md, fontWeight: '600', color: t.colors.text, marginTop: t.spacing.sm},
    introHint: {fontSize: t.fontSize.sm, lineHeight: 21, color: t.colors.textSub, marginTop: t.spacing.sm},
    toolbarButton: {minHeight: 48, paddingHorizontal: t.spacing.sm, justifyContent: 'center'},
    card: {flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.md, paddingHorizontal: t.spacing.md, minHeight: 88, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.divider, borderRadius: t.radius.xl},
    cardSelected: {backgroundColor: t.colors.primaryLight, borderColor: t.colors.primary},
    iconBox: {width: 44, height: 44, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceHigh, alignItems: 'center', justifyContent: 'center'},
    cardContent: {flex: 1, minWidth: 0, marginHorizontal: t.spacing.md},
    cardTitle: {fontSize: t.fontSize.base, color: t.colors.text, fontWeight: '600'},
  });

  return (
    <View style={s.container}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header
        title="无缓存收藏夹"
        showBack
        right={uid && folders && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="保存无缓存收藏夹设置" onPress={onSave} style={s.saveButton}>
            <Text style={s.saveText}>保存</Text>
          </TouchableOpacity>
        )}
      />
      {!uid ? (
        <Empty title="登录后设置缓存偏好" hint="前往设置登录 B 站，选择无需缓存的收藏夹" />
      ) : folders === null && !error ? (
        <Loading />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load(true)} />
      ) : folders!.length === 0 ? (
        <Empty title="暂无收藏夹" hint="收藏夹会在登录并同步后显示在这里" />
      ) : (
        <>
          <FlatList
            style={s.fill}
            contentContainerStyle={s.list}
            data={folders!}
            showsVerticalScrollIndicator={false}
            keyExtractor={(it) => String(it.id)}
            extraData={localNoCache}
            ListHeaderComponent={
              <View>
                <View style={s.intro}>
                  <Icon name="cloud-off-outline" size={28} color={t.colors.primary} />
                  <Text accessibilityRole="header" style={s.introTitle}>按收藏夹管理缓存</Text>
                  <Text style={s.introHint}>选中的收藏夹不缓存音频，播放时仍需网络。点按右上角“保存”后生效。</Text>
                </View>
                <View style={s.toolbar}>
                  <TouchableOpacity accessibilityRole="button" onPress={onSelectAll} style={s.toolbarButton}>
                    <Text style={{ color: t.colors.primary, fontSize: t.fontSize.sm }}>全选</Text>
                  </TouchableOpacity>
                  <Text accessibilityLiveRegion="polite" style={{ color: t.colors.textSub, fontSize: t.fontSize.sm }}>
                    已选 {folders!.filter(f => isFolderNoCache(f.id)).length}/{folders!.length} 个
                  </Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="清空无缓存收藏夹选择" onPress={onDeselectAll} style={s.toolbarButton}>
                    <Text style={{ color: t.colors.textSub, fontSize: t.fontSize.sm }}>清空</Text>
                  </TouchableOpacity>
                </View>
              </View>
            }
            ItemSeparatorComponent={() => <View style={{ height: t.spacing.md }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={t.colors.primary} />
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityLabel={`${item.title}，${item.mediaCount} 个视频，不缓存音频`}
                accessibilityState={{checked: isFolderNoCache(item.id)}}
                activeOpacity={0.76}
                onPress={() => toggleFolder(item.id)}
                style={[s.card, isFolderNoCache(item.id) && s.cardSelected]}
              >
                <View style={s.iconBox}>
                  <Icon name="folder-music-outline" size={24} color={t.colors.primary} />
                </View>
                <View style={s.cardContent}>
                  <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: t.spacing.xs}}>{item.mediaCount} 个视频 · {isFolderNoCache(item.id) ? '不缓存音频' : '沿用缓存设置'}</Text>
                </View>
                <Icon name={isFolderNoCache(item.id) ? 'check-circle' : 'checkbox-blank-circle-outline'} size={24} color={isFolderNoCache(item.id) ? t.colors.primary : t.colors.textSub} />
              </TouchableOpacity>
            )}
          />
        </>
      )}
    </View>
  );
};
