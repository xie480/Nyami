import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button} from './Button';
import {IconButton} from './IconButton';
import {favoriteService} from '../services/favoriteService';
import {useAuthStore} from '../store/authStore';
import {useTheme} from '../theme';
import type {FavoriteFolder, OnlineVideoSearchResult} from '../types/domain';

interface FavoriteFolderPickerSheetProps {
  visible: boolean;
  video: OnlineVideoSearchResult | null;
  onClose: () => void;
}

/** 搜索与个性化播放共用的 B 站自有收藏夹选择、新建及写入弹层。 */
export const FavoriteFolderPickerSheet: React.FC<FavoriteFolderPickerSheetProps> = ({
  visible,
  video,
  onClose,
}) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const uid = useAuthStore(state => state.userId);
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFolderTitle, setNewFolderTitle] = useState('');
  const [newFolderPrivate, setNewFolderPrivate] = useState(false);

  const loadFolders = useCallback(async () => {
    if (!uid || !visible) return;
    const requestUid = uid;
    setLoading(true);
    setError(null);
    try {
      const response = await favoriteService.getFolders(requestUid, true);
      if (useAuthStore.getState().userId !== requestUid) return;
      const ownedFolders = response.filter(folder => String(folder.mid) === requestUid);
      setFolders(ownedFolders);
      setSelectedIds(current => current.filter(id => ownedFolders.some(folder => folder.id === id)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载收藏夹失败');
    } finally {
      setLoading(false);
    }
  }, [uid, visible]);

  useEffect(() => {
    if (visible) {
      setShowCreateForm(false);
      setNewFolderTitle('');
      void loadFolders();
    } else {
      setFolders([]);
      setSelectedIds([]);
      setError(null);
    }
  }, [loadFolders, visible]);

  const createFolder = useCallback(async () => {
    if (!uid || !newFolderTitle.trim()) {
      setError('请输入收藏夹名称');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const folder = await favoriteService.createFavoriteFolder(
        uid,
        newFolderTitle,
        newFolderPrivate ? 1 : 0,
      );
      if (useAuthStore.getState().userId !== uid) return;
      setFolders(current => [...current.filter(item => item.id !== folder.id), folder]);
      setSelectedIds(current => current.includes(folder.id) ? current : [...current, folder.id]);
      setNewFolderTitle('');
      setShowCreateForm(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '新建收藏夹失败');
    } finally {
      setLoading(false);
    }
  }, [newFolderPrivate, newFolderTitle, uid]);

  const saveVideo = useCallback(async () => {
    if (!uid || !video || saving) return;
    if (selectedIds.length === 0) {
      setError('请至少选择一个收藏夹');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await favoriteService.addSearchResultToFolders(uid, video, selectedIds);
      const confirmedCount = result.confirmedFolderIds.length;
      const unconfirmedCount = result.unconfirmedFolderIds.length;
      if (confirmedCount === 0 || unconfirmedCount > 0) {
        setError(
          confirmedCount === 0
            ? result.writeErrorMessage || 'B 站尚未确认收藏状态，请刷新后确认。'
            : `B 站已确认 ${confirmedCount} 个收藏夹，另有 ${unconfirmedCount} 个尚未确认。`,
        );
        return;
      }
      onClose();
      const message = '已收藏到 B 站收藏夹';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      else Alert.alert('完成', message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '收藏失败');
    } finally {
      setSaving(false);
    }
  }, [onClose, saving, selectedIds, uid, video]);

  const toggleFolder = (folderId: number) => {
    setSelectedIds(current => current.includes(folderId)
      ? current.filter(id => id !== folderId)
      : [...current, folderId]);
  };

  const surface = t.glass?.colors.glass.bg ?? t.colors.surface;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={{flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.44)'}}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="关闭收藏夹选择"
          activeOpacity={1}
          onPress={onClose}
          style={{flex: 1}}
        />
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingTop: t.spacing.lg,
            paddingBottom: Math.max(insets.bottom, t.spacing.lg),
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            backgroundColor: t.isDark ? '#18191C' : '#FFFFFF',
            borderColor: t.colors.divider,
            borderWidth: 1,
            maxHeight: '78%',
          }}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
            <View style={{flex: 1, paddingRight: t.spacing.md}}>
              <Text style={{fontSize: t.fontSize.lg, fontWeight: '700', color: t.colors.text}}>
                添加到收藏夹
              </Text>
              <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
                {video?.title ?? ''}
              </Text>
            </View>
            <IconButton name="close" size={24} color={t.colors.textSub} onPress={onClose} />
          </View>

          <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, marginTop: t.spacing.md}}>
            仅显示当前账号创建的 B 站收藏夹
          </Text>
          <ScrollView
            style={{maxHeight: 300, marginTop: t.spacing.sm}}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {loading && folders.length === 0 ? (
              <Text style={{paddingVertical: t.spacing.lg, textAlign: 'center', color: t.colors.textSub}}>
                正在读取收藏夹…
              </Text>
            ) : folders.length === 0 ? (
              <Text style={{paddingVertical: t.spacing.lg, color: t.colors.textHint}}>
                暂无可用收藏夹，请新建一个。
              </Text>
            ) : folders.map(folder => {
              const selected = selectedIds.includes(folder.id);
              return (
                <TouchableOpacity
                  key={folder.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{checked: selected}}
                  onPress={() => toggleFolder(folder.id)}
                  activeOpacity={0.72}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: 52,
                    paddingHorizontal: t.spacing.md,
                    borderRadius: t.radius.lg,
                    backgroundColor: selected ? t.colors.primaryLight : surface,
                    marginBottom: t.spacing.xs,
                  }}>
                  <Icon
                    name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'}
                    size={22}
                    color={selected ? t.colors.primary : t.colors.textHint}
                  />
                  <View style={{flex: 1, marginLeft: t.spacing.md}}>
                    <Text style={{color: t.colors.text, fontSize: t.fontSize.sm, fontWeight: '600'}} numberOfLines={1}>
                      {folder.title}
                    </Text>
                    <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs, marginTop: 2}}>
                      {folder.mediaCount} 首
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {showCreateForm && (
            <View style={{marginTop: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.lg, backgroundColor: surface}}>
              <TextInput
                value={newFolderTitle}
                onChangeText={setNewFolderTitle}
                placeholder="新收藏夹名称"
                placeholderTextColor={t.colors.textHint}
                maxLength={40}
                style={{color: t.colors.text, borderBottomWidth: 1, borderBottomColor: t.colors.divider, paddingVertical: t.spacing.sm}}
              />
              <TouchableOpacity
                onPress={() => setNewFolderPrivate(value => !value)}
                style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.sm}}>
                <Icon
                  name={newFolderPrivate ? 'lock-outline' : 'earth'}
                  size={18}
                  color={t.colors.primary}
                />
                <Text style={{color: t.colors.textSub, fontSize: t.fontSize.xs, marginLeft: t.spacing.xs}}>
                  新建为{newFolderPrivate ? '私密' : '公开'}收藏夹
                </Text>
              </TouchableOpacity>
              <Button
                title="创建并选中"
                onPress={createFolder}
                loading={loading}
                disabled={loading || !newFolderTitle.trim()}
                style={{marginTop: t.spacing.md}}
              />
            </View>
          )}

          {error && (
            <Text style={{color: t.colors.error, fontSize: t.fontSize.xs, marginTop: t.spacing.sm}}>
              {error}
            </Text>
          )}
          <View style={{flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.md}}>
            <Button
              title={showCreateForm ? '取消新建' : '＋ 新建收藏夹'}
              variant="text"
              onPress={() => setShowCreateForm(value => !value)}
              disabled={saving || loading}
              style={{flex: 1}}
            />
            <Button
              title={`收藏（${selectedIds.length}）`}
              onPress={saveVideo}
              loading={saving}
              disabled={saving || loading || selectedIds.length === 0}
              style={{flex: 1}}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};
