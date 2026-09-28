import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GlassView} from '../components/GlassView';
import {IconButton} from '../components/IconButton';
import {useHomeRecommendations} from '../hooks/useHomeRecommendations';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';
import {useAuthStore} from '../store/authStore';
import {prefetchAudioUrl} from '../services/dataPrefetcher';
import {loadQueue, resolveCurrentTrack} from '../services/trackPlayer';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import {useTheme} from '../theme';
import {config} from '../config';
import type {CollectionRecommendation, TagRecommendation} from '../types/domain';

function updateTimeLabel(timestamp: number | null): string {
  if (!timestamp) return '首页打开时为你生成';
  return new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/** 登录后的发现首页：以现有 UID 画像、外部播放列表和 B 站搜索能力组织推荐入口。 */
export const DiscoverScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {uid, feed, refreshing, refresh} = useHomeRecommendations();
  const biliAvatar = useAuthStore(state => state.userInfo?.avatar ?? '');
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('');
  const setQueue = usePlayerStore(state => state.setQueue);

  const startPlayback = useCallback((selectedVideo: TagRecommendation) => {
    const videos = feed.songs.map(searchVideoToFavoriteVideo);
    if (videos.length === 0 || !uid) return;
    try {
      setQueue(videos, selectedVideo.bvid, {
        isPersonalized: true,
        recommendationPage: feed.songPage || 1,
        recommendationHasMore: feed.songHasMore,
      });
      usePlayerStore.getState().setResolving(true);
      useProgressStore.getState().resetProgress();
      prefetchAudioUrl(selectedVideo.bvid).catch(() => {});
      const selectedIndex = videos.findIndex(video => video.bvid === selectedVideo.bvid);
      const previousVideo = selectedIndex > 0 ? videos[selectedIndex - 1] : undefined;
      if (previousVideo) prefetchAudioUrl(previousVideo.bvid, previousVideo.parts?.[0]?.cid).catch(() => {});
      navigation.navigate('Player');
      InteractionManager.runAfterInteractions(() => {
        void (async () => {
          try {
            const revision = await loadQueue(videos, selectedVideo.bvid);
            if (!revision) {
              throw new Error(usePlayerStore.getState().playbackError || '推荐歌曲暂时无法播放');
            }
            resolveCurrentTrack(revision).catch(() => {});
          } catch (error) {
            usePlayerStore.getState().setResolving(false);
            Alert.alert('播放失败', error instanceof Error ? error.message : '推荐歌曲暂时无法播放');
          }
        })();
      });
    } catch (error) {
      usePlayerStore.getState().setResolving(false);
      Alert.alert('播放失败', error instanceof Error ? error.message : '推荐歌曲暂时无法播放');
    }
  }, [feed.songHasMore, feed.songPage, feed.songs, navigation, setQueue, uid]);

  const openCollection = useCallback((source: CollectionRecommendation) => {
    navigation.navigate('Videos', {
      source,
      title: source.title,
      includeVideoParts: true,
    });
  }, [navigation]);

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;
  const avatarUrl = biliAvatar
    ? biliAvatar.startsWith('//')
      ? `https:${biliAvatar}`
      : biliAvatar.replace(/^http:\/\//i, 'https://')
    : '';
  const showAvatar = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl;
  const previewCollections = feed.collections.slice(0, config.recommendations.homePlaylistPreviewCount);
  const previewSongs = feed.songs.slice(0, config.recommendations.homeSongPreviewCount);

  const renderCollectionCard = (item: CollectionRecommendation) => (
    <TouchableOpacity
      key={item.sourceKey}
      accessibilityRole="button"
      accessibilityLabel={`打开合集 ${item.title}`}
      activeOpacity={0.82}
      onPress={() => openCollection(item)}
      style={{width: 204, marginRight: t.spacing.md}}>
      <View style={{height: 128, overflow: 'hidden', borderRadius: 16, backgroundColor: t.colors.surfaceHigh}}>
        {item.cover ? (
          <FastImage
            source={{uri: item.cover}}
            style={{width: '100%', height: '100%'}}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
            <Icon name="playlist-music" size={36} color={t.colors.primary} />
          </View>
        )}
        <View style={{position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(15,15,20,0.7)'}}>
          <Icon name="play" size={14} color="#fff" />
          <Text style={{fontSize: t.fontSize.xs, color: '#fff', marginLeft: 3}}>{item.mediaCount} 个视频</Text>
        </View>
      </View>
      <Text style={{fontSize: t.fontSize.base, lineHeight: 22, fontWeight: '700', color: t.colors.text, marginTop: t.spacing.sm}} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 3}} numberOfLines={1}>
        {item.ownerName || 'B 站 UP 主'} · {item.kind === 'subscribedSeason' ? '订阅合集' : '他人收藏夹'}
      </Text>
      <Text style={{fontSize: t.fontSize.xs, lineHeight: 18, color: t.colors.textHint, marginTop: 5, minHeight: 36}} numberOfLines={2}>
        {item.description?.trim() || `B 站暂未提供简介 · 收录 ${item.mediaCount} 个视频`}
      </Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', marginTop: 5}}>
        {item.matchedTags.slice(0, 3).map(tag => (
          <View key={`${item.sourceKey}:${tag}`} style={{paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: t.colors.primaryLight, marginRight: 5, marginBottom: 4}}>
            <Text style={{fontSize: 10, color: t.colors.primary}}>{tag}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );

  const renderSong = (item: TagRecommendation) => (
    <View key={item.bvid} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.sm, borderTopWidth: 1, borderTopColor: glassBorder}}>
      <FastImage
        source={{uri: item.cover}}
        style={{width: 54, height: 54, borderRadius: 12, backgroundColor: t.colors.surfaceHigh}}
        resizeMode={FastImage.resizeMode.cover}
      />
      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.72}
        onPress={() => void startPlayback(item)}
        style={{flex: 1, marginHorizontal: t.spacing.md}}>
        <Text style={{fontSize: t.fontSize.sm, fontWeight: '600', color: t.colors.text}} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
          {item.author} · {item.matchedTags.slice(0, 2).join(' / ')}
        </Text>
      </TouchableOpacity>
      <IconButton
        name="play-circle"
        size={30}
        color={t.colors.primary}
        accessibilityLabel={`播放 ${item.title}`}
        onPress={() => void startPlayback(item)}
      />
    </View>
  );

  return (
    <View style={{flex: 1, backgroundColor: t.glass ? 'transparent' : t.colors.background}}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh('manual')}
            tintColor={t.colors.primary}
          />
        )}
        contentContainerStyle={{paddingTop: Math.max(insets.top, 12) + t.spacing.sm, paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xl}}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.md}}>
          <View>
            <Text style={{fontSize: t.fontSize.xxl, fontWeight: '800', color: t.colors.text}}>发现好音乐</Text>
            <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: 3}}>按你的收藏画像，每 5 小时挑一份灵感</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="用户画像"
            activeOpacity={0.75}
            onPress={() => navigation.navigate('TagRecommendations')}
            style={{width: 42, height: 42, borderRadius: 21, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surfaceHigh}}>
            {showAvatar ? (
              <FastImage
                source={{uri: avatarUrl}}
                style={{width: 42, height: 42, borderRadius: 21}}
                resizeMode={FastImage.resizeMode.cover}
                onError={() => setFailedAvatarUrl(avatarUrl)}
              />
            ) : (
              <Icon name="account-circle-outline" size={28} color={t.colors.textSub} />
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}
          style={{marginBottom: t.spacing.md}}>
          <GlassView borderRadius={22} backgroundColor={glassBackground} borderColor={glassBorder} noShadow noBlur>
            <View style={{height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.lg}}>
              <Icon name="magnify" size={22} color={t.colors.textSub} />
              <Text style={{flex: 1, marginLeft: t.spacing.md, color: t.colors.textHint, fontSize: t.fontSize.base}}>
                搜索 B 站视频、tag、时长条件
              </Text>
              <Icon name="tune-variant" size={20} color={t.colors.primary} />
            </View>
          </GlassView>
        </TouchableOpacity>

        <GlassView borderRadius={22} backgroundColor={glassBackground} borderColor={glassBorder} noShadow noBlur style={{marginBottom: t.spacing.md}}>
          <View style={{minHeight: 76, flexDirection: 'row', alignItems: 'center', padding: t.spacing.md}}>
            <View style={{width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: t.colors.primaryLight}}>
              <Icon name="creation" size={23} color={t.colors.primary} />
            </View>
            <View style={{flex: 1, marginHorizontal: t.spacing.md}}>
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.text, fontWeight: '700'}}>
                {refreshing ? '正在为你生成推荐' : feed.updatedAt ? `推荐已更新 · ${updateTimeLabel(feed.updatedAt)}` : '首页打开时生成推荐'}
              </Text>
              <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}}>
                {refreshing ? '读取收藏画像与 B 站推荐内容…' : '每 5 小时自动更新，需要时可手动刷新'}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="手动刷新首页推荐"
              disabled={!uid || refreshing}
              onPress={() => void refresh('manual')}
              style={{flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.colors.primary, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 8, opacity: !uid || refreshing ? 0.5 : 1}}>
              {refreshing ? <ActivityIndicator size="small" color={t.colors.primary} /> : <Icon name="refresh" size={17} color={t.colors.primary} />}
              <Text style={{fontSize: t.fontSize.xs, color: t.colors.primary, fontWeight: '600', marginLeft: 5}}>刷新</Text>
            </TouchableOpacity>
          </View>
        </GlassView>

        {feed.error && (
          <View style={{padding: t.spacing.md, borderRadius: 16, backgroundColor: t.colors.error + '18', marginBottom: t.spacing.md}}>
            <Text style={{fontSize: t.fontSize.xs, color: t.colors.error}}>{feed.error}</Text>
            {!refreshing && <Text onPress={() => void refresh('manual')} style={{fontSize: t.fontSize.xs, color: t.colors.primary, marginTop: 5}}>点此手动重试</Text>}
          </View>
        )}

        <GlassView borderRadius={24} backgroundColor={glassBackground} borderColor={glassBorder} noShadow noBlur style={{marginBottom: t.spacing.md}}>
          <View style={{padding: t.spacing.md}}>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.md}}>
              <View style={{width: 42, height: 42, borderRadius: 14, backgroundColor: t.colors.primaryLight, alignItems: 'center', justifyContent: 'center'}}>
                <Icon name="playlist-play" size={24} color={t.colors.primary} />
              </View>
              <View style={{flex: 1, marginLeft: t.spacing.md}}>
                <Text style={{fontSize: t.fontSize.lg, fontWeight: '800', color: t.colors.text}}>推荐合集 / 收藏夹</Text>
                <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 3}}>从你收藏的他人歌单中，发现下一份喜欢</Text>
              </View>
              <TouchableOpacity onPress={() => navigation.navigate('PlaylistRecommendations')} style={{flexDirection: 'row', alignItems: 'center', padding: 4}}>
                <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub}}>查看全部</Text>
                <Icon name="chevron-right" size={18} color={t.colors.textSub} />
              </TouchableOpacity>
            </View>
            {previewCollections.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {previewCollections.map(renderCollectionCard)}
              </ScrollView>
            ) : (
              <TouchableOpacity onPress={() => navigation.navigate('VisibleFolders')} style={{paddingVertical: t.spacing.lg, alignItems: 'center'}}>
                <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, textAlign: 'center'}}>
                  {refreshing ? '正在整理收藏夹与合集…' : '还没有可推荐的他人收藏夹或订阅合集'}
                </Text>
                {!refreshing && <Text style={{fontSize: t.fontSize.xs, color: t.colors.primary, marginTop: 6}}>管理首页播放列表偏好</Text>}
              </TouchableOpacity>
            )}
          </View>
        </GlassView>

        <GlassView borderRadius={24} backgroundColor={glassBackground} borderColor={glassBorder} noShadow noBlur>
          <View style={{padding: t.spacing.md}}>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.xs}}>
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.75}
                disabled={previewSongs.length === 0}
                onPress={() => void startPlayback(previewSongs[0])}
                style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                <View style={{width: 42, height: 42, borderRadius: 21, backgroundColor: t.colors.primaryLight, alignItems: 'center', justifyContent: 'center'}}>
                  <Icon name="music-note" size={23} color={t.colors.primary} />
                </View>
                <View style={{flex: 1, marginLeft: t.spacing.md}}>
                  <Text style={{fontSize: t.fontSize.lg, fontWeight: '800', color: t.colors.text}}>歌曲推荐</Text>
                  <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 3}}>连续预加载 · 根据你的 tag 画像推荐</Text>
                </View>
                <Icon name="play-circle" size={25} color={t.colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="查看全部歌曲推荐"
                activeOpacity={0.75}
                onPress={() => navigation.navigate('SongRecommendations')}
                style={{flexDirection: 'row', alignItems: 'center', marginLeft: t.spacing.sm, paddingVertical: t.spacing.sm}}>
                <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub}}>查看全部</Text>
                <Icon name="chevron-right" size={18} color={t.colors.textSub} />
              </TouchableOpacity>
            </View>
            {previewSongs.length > 0 ? (
              previewSongs.map(renderSong)
            ) : (
              <View style={{paddingVertical: t.spacing.lg, alignItems: 'center'}}>
                <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, textAlign: 'center'}}>
                  {refreshing ? '正在根据你的画像找歌…' : '暂时没有推荐歌曲；同步收藏并补齐 tag 后可生成画像'}
                </Text>
                {!refreshing && <Text onPress={() => navigation.navigate('TagRecommendations')} style={{fontSize: t.fontSize.xs, color: t.colors.primary, marginTop: 6}}>查看用户画像</Text>}
              </View>
            )}
            {feed.failedSearchCount > 0 && (
              <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, marginTop: t.spacing.sm}}>
                部分画像关键词搜索失败，可稍后手动刷新。
              </Text>
            )}
          </View>
        </GlassView>
      </ScrollView>
    </View>
  );
};
