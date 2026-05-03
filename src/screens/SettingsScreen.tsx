import React, { useEffect, useState, useCallback } from 'react';
import { SafeAreaView, StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, StyleSheet, Alert, TextInput,
} from 'react-native';
import { Header } from '../components/Header';
import { ListItem } from '../components/ListItem';
import { Switch } from '../components/Switch';
import { useSettingsStore } from '../store/settingsStore';
import { useUserStore } from '../store/userStore';
import { useSyncStore } from '../store/syncStore';
import { audioCache } from '../services/audioCache';
import { cookieService, favoriteService } from '../services';
import { formatBytes } from '../utils/format';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Quality } from '../types/domain';

const QUALITY_OPTIONS: Array<{ key: Quality; title: string; subtitle: string }> = [
  { key: 'low', title: '省流', subtitle: '64 kbps，约 1.9MB / 4 分钟' },
  { key: 'medium', title: '标准', subtitle: '132 kbps，约 3.8MB / 4 分钟' },
  { key: 'high', title: '高音质', subtitle: '192 kbps，约 5.5MB / 4 分钟' },
];

export const SettingsScreen = ({ navigation }: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {
    quality, autoCacheOnWifi, wifiOnly, hiddenFolderIds,
    setQuality, setAutoCacheOnWifi, setWifiOnly,
  } = useSettingsStore();
  const uid = useUserStore((s) => s.uid);
  const setUid = useUserStore((s) => s.setUid);
  const [newUid, setNewUid] = useState(uid);

  const [cacheSize, setCacheSize] = useState(0);
  const [cacheCount, setCacheCount] = useState(0);
  const [cookie, setCookie] = useState(cookieService.get());
  const { syncStatus, progressData, syncError, startSync, resetSyncState } = useSyncStore();
  const [globalIndexCount, setGlobalIndexCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const currentStatus = useSyncStore.getState().syncStatus;
      if (currentStatus === 'done' || currentStatus === 'error') {
        resetSyncState();
      }
    }, [resetSyncState])
  );

  const refresh = () => {
    setCacheSize(audioCache.getTotalSize());
    setCacheCount(audioCache.getCount());
  };

  useEffect(() => {
    refresh();
    setGlobalIndexCount(favoriteService.getGlobalIndex().length);
  }, []);

  useEffect(() => {
    if (syncStatus === 'done') {
      setGlobalIndexCount(favoriteService.getGlobalIndex().length);
    }
  }, [syncStatus]);

  const onClear = () => {
    Alert.alert('确认清空', '将删除所有已缓存的音频文件', [
      { text: '取消' },
      {
        text: '清空', style: 'destructive',
        onPress: async () => { await audioCache.clearAll(); refresh(); },
      },
    ]);
  };

  const onSyncGlobalIndex = () => {
    if (!uid) {
      Alert.alert('提示', '请先设置 UID');
      return;
    }
    // 传入 hiddenFolderIds，仅同步用户选中的收藏夹
    startSync(uid, hiddenFolderIds, true);
  };

  const onSaveCookie = () => {
    // Validate cookie format before saving
    const sess = cookieService.extractSessdata(cookie);
    if (!sess) {
      Alert.alert('无效的 Cookie', '请确保输入包含 SESSDATA=...');
      return;
    }
    cookieService.set(cookie);
    Alert.alert('已保存', '已清除相关缓存，重新进入收藏夹将使用新身份');
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    section: {
      fontSize: t.fontSize.sm, color: t.colors.textSub,
      marginTop: t.spacing.xxl, marginBottom: t.spacing.sm,
      marginHorizontal: t.spacing.lg,
    },
    group: {
      marginHorizontal: t.spacing.lg,
      borderRadius: t.radius.lg, overflow: 'hidden',
      backgroundColor: t.colors.surface,
    },
    sep: { height: 0.5, backgroundColor: t.colors.divider, marginLeft: t.spacing.lg },
    cookieBox: { padding: t.spacing.lg, backgroundColor: t.colors.surface },
    input: {
      borderWidth: 1, borderColor: t.colors.divider, borderRadius: t.radius.md,
      paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm,
      fontSize: t.fontSize.sm, color: t.colors.text, minHeight: 40,
    },
    cookieHint: { fontSize: t.fontSize.xs, color: t.colors.textHint, marginTop: t.spacing.sm },
    saveText: {
      color: t.colors.primary, marginTop: t.spacing.sm,
      fontSize: t.fontSize.base, textAlign: 'right',
    },
    danger: { color: t.colors.error, fontSize: t.fontSize.base },
  });

  return (
    <SafeAreaView style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header title="设置" showBack />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text style={s.section}>音质</Text>
        <View style={s.group}>
          {QUALITY_OPTIONS.map((opt, i) => (
            <React.Fragment key={opt.key}>
              {i > 0 && <View style={s.sep} />}
              <ListItem
                title={opt.title}
                subtitle={opt.subtitle}
                onPress={() => setQuality(opt.key)}
                right={
                  quality === opt.key ? (
                    <Text style={{ color: t.colors.primary, fontSize: 18 }}>✓</Text>
                  ) : null
                }
              />
            </React.Fragment>
          ))}
        </View>

        <Text style={s.section}>流量</Text>
        <View style={s.group}>
          <ListItem
            title="仅 WiFi 下加载"
            right={<Switch value={wifiOnly} onValueChange={setWifiOnly} />}
          />
          <View style={s.sep} />
          <ListItem
            title="WiFi 下自动缓存已播放音频"
            right={<Switch value={autoCacheOnWifi} onValueChange={setAutoCacheOnWifi} />}
          />
        </View>

        <Text style={s.section}>全局索引</Text>
        <View style={s.group}>
          <ListItem
            title="可见收藏夹偏好"
            subtitle={`已选 ${(favoriteService.getGlobalIndex().length > 0 ? globalIndexCount : '...')} 个视频参与索引`}
            onPress={() => navigation.navigate('VisibleFolders')}
            showArrow
          />
          <View style={s.sep} />
          <ListItem
            title="同步全局索引"
            subtitle={
              syncStatus === 'syncing'
                ? progressData
                  ? `正在同步... ${progressData.completedTasks}/${progressData.totalTasks} 任务, ${progressData.processedVideos}/${progressData.totalVideos} 视频`
                  : '正在获取收藏夹列表...'
                : syncStatus === 'error'
                ? `同步失败: ${syncError}`
                : syncStatus === 'done'
                ? '同步完成'
                : `当前已索引 ${globalIndexCount} 个视频`
            }
            onPress={syncStatus === 'syncing' ? undefined : onSyncGlobalIndex}
            right={
              syncStatus === 'syncing' ? (
                <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.base }}>同步中...</Text>
              ) : syncStatus === 'error' ? (
                <Text style={{ color: t.colors.error, fontSize: t.fontSize.base }}>重试</Text>
              ) : (
                <Text style={{ color: t.colors.primary, fontSize: t.fontSize.base }}>开始同步</Text>
              )
            }
          />
          {syncStatus === 'syncing' && (
            <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.md }}>
              <View style={{ height: 4, backgroundColor: t.colors.divider, borderRadius: 2, overflow: 'hidden' }}>
                <View
                  style={{
                    height: '100%',
                    backgroundColor: t.colors.primary,
                    width: progressData ? `${(progressData.completedTasks / Math.max(1, progressData.totalTasks)) * 100}%` : '0%',
                  }}
                />
              </View>
            </View>
          )}
        </View>

        <Text style={s.section}>缓存</Text>
        <View style={s.group}>
          <ListItem
            title="已缓存音频"
            right={
              <Text style={{ color: t.colors.textSub, fontSize: t.fontSize.sm }}>
                {cacheCount} / {formatBytes(cacheSize)}
              </Text>
            }
          />
          <View style={s.sep} />
          <ListItem
            title="清空全部缓存"
            onPress={onClear}
            right={<Text style={s.danger}>清空</Text>}
          />
        </View>

        <Text style={s.section}>登录</Text>
        <View style={[s.group, s.cookieBox]}>
          <Text style={{ fontSize: t.fontSize.base, color: t.colors.text, marginBottom: t.spacing.sm }}>
            SESSDATA Cookie
          </Text>
          <TextInput
            style={s.input}
            value={cookie}
            onChangeText={setCookie}
            placeholder="SESSDATA=xxxxxxxxxx"
            placeholderTextColor={t.colors.textHint}
            multiline
            secureTextEntry
          />
          <Text style={s.cookieHint}>
            用于加载私密收藏夹和高音质。从浏览器 F12 → Application → Cookie 中复制 SESSDATA
          </Text>
          <Text style={s.saveText} onPress={onSaveCookie}>保存</Text>
        </View>

        {/* UID 编辑区 */}
        <Text style={s.section}>用户 UID</Text>
        <View style={s.group}>
          <TextInput
            style={s.input}
            value={newUid}
            onChangeText={setNewUid}
            placeholder="请输入 UID"
            placeholderTextColor={t.colors.textHint}
          />
          <Text style={s.saveText} onPress={() => { setUid(newUid); Alert.alert('已保存', 'UID 已更新'); }}>保存 UID</Text>
        </View>
        <Text style={s.section}>关于</Text>
        <View style={s.group}>
          <ListItem title="版本号" right={<Text style={{ color: t.colors.textSub }}>v1.0.0</Text>} />
          <View style={s.sep} />
          <ListItem title="开源协议" subtitle="本应用仅供个人学习使用" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
