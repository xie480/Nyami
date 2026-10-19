import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GlassView} from '../components/GlassView';
import {SubscribePlaylistButton} from '../components/SubscribePlaylistButton';
import {useHomeRecommendations} from '../hooks/useHomeRecommendations';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';
import {useAuthStore} from '../store/authStore';
import {prefetchAudioUrl} from '../services/dataPrefetcher';
import {loadQueue, resolveCurrentTrack} from '../services/trackPlayer';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import {useTheme} from '../theme';
import {config} from '../config';
import type {
  CollectionRecommendation,
  TagRecommendation,
} from '../types/domain';

function updateTimeLabel(timestamp: number | null): string {
  if (!timestamp) {
    return '首页打开时为你生成';
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 登录后的发现首页：以现有 UID 画像、外部播放列表和 B 站搜索能力组织推荐入口。 */
export const DiscoverScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const {
    uid,
    feed,
    refreshing,
    refresh,
    homeRefreshMode,
    homeRefreshIntervalHours,
  } = useHomeRecommendations();
  const biliAvatar = useAuthStore(state => state.userInfo?.avatar ?? '');
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('');
  const setQueue = usePlayerStore(state => state.setQueue);

  const startPlayback = useCallback(
    (selectedVideo: TagRecommendation) => {
      const videos = feed.songs.map(searchVideoToFavoriteVideo);
      if (videos.length === 0 || !uid) {
        return;
      }
      try {
        usePlayerStore.getState().setPlayMode('sequential');
        setQueue(videos, selectedVideo.bvid, {
          isPersonalized: true,
          recommendationPage: feed.songPage || 1,
          recommendationHasMore: feed.songHasMore,
        });
        usePlayerStore.getState().setResolving(true);
        useProgressStore.getState().resetProgress();
        prefetchAudioUrl(selectedVideo.bvid).catch(() => {});
        const selectedIndex = videos.findIndex(
          video => video.bvid === selectedVideo.bvid,
        );
        const previousVideo =
          selectedIndex > 0 ? videos[selectedIndex - 1] : undefined;
        if (previousVideo) {
          prefetchAudioUrl(
            previousVideo.bvid,
            previousVideo.parts?.[0]?.cid,
          ).catch(() => {});
        }
        navigation.navigate('Player');
        void (async () => {
          try {
            const revision = await loadQueue(videos, selectedVideo.bvid);
            if (!revision) {
              throw new Error(
                usePlayerStore.getState().playbackError ||
                  '推荐歌曲暂时无法播放',
              );
            }
            resolveCurrentTrack(revision).catch(() => {});
          } catch (error) {
            usePlayerStore.getState().setResolving(false);
            Alert.alert(
              '播放失败',
              error instanceof Error ? error.message : '推荐歌曲暂时无法播放',
            );
          }
        })();
      } catch (error) {
        usePlayerStore.getState().setResolving(false);
        Alert.alert(
          '播放失败',
          error instanceof Error ? error.message : '推荐歌曲暂时无法播放',
        );
      }
    },
    [feed.songHasMore, feed.songPage, feed.songs, navigation, setQueue, uid],
  );

  const openCollection = useCallback(
    (source: CollectionRecommendation) => {
      navigation.navigate('Videos', {
        source,
        title: source.title,
        includeVideoParts: true,
      });
    },
    [navigation],
  );

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;
  const avatarUrl = biliAvatar
    ? biliAvatar.startsWith('//')
      ? `https:${biliAvatar}`
      : biliAvatar.replace(/^http:\/\//i, 'https://')
    : '';
  const showAvatar = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl;
  const previewCollections = feed.collections.slice(
    0,
    config.recommendations.homePlaylistPreviewCount,
  );
  const previewSongs = feed.songs.slice(
    0,
    config.recommendations.homeSongPreviewCount,
  );

  const collectionWidth = Math.min(232, Math.max(180, width * 0.6));

  const renderCollectionCard = (item: CollectionRecommendation) => (
    <View
      key={item.sourceKey}
      style={{
        width: collectionWidth,
        marginRight: t.spacing.md,
        padding: t.spacing.sm,
        borderRadius: 20,
        backgroundColor: glassBackground,
        borderWidth: 1,
        borderColor: glassBorder,
      }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`打开合集 ${item.title}，${item.mediaCount} 个视频`}
        activeOpacity={0.8}
        onPress={() => openCollection(item)}>
        <View
          style={{
            height: 140,
            overflow: 'hidden',
            borderRadius: 14,
            backgroundColor: t.colors.surfaceHigh,
          }}>
          {item.cover ? (
            <FastImage
              source={{uri: item.cover}}
              style={{width: '100%', height: '100%'}}
              resizeMode={FastImage.resizeMode.cover}
            />
          ) : (
            <View
              style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
              <Icon
                accessible={false}
                name="playlist-music"
                size={36}
                color={t.colors.textSub}
              />
            </View>
          )}
          <View
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: 'rgba(15,15,20,0.8)',
            }}>
            <Text style={{fontSize: t.fontSize.xs, color: '#fff'}}>
              {item.mediaCount} 个视频
            </Text>
          </View>
        </View>
        <Text
          style={{
            fontSize: t.fontSize.base,
            lineHeight: 23,
            fontWeight: '700',
            color: t.colors.text,
            marginTop: t.spacing.md,
            minHeight: 46,
          }}
          numberOfLines={2}>
          {item.title}
        </Text>
        <Text
          style={{
            fontSize: t.fontSize.sm,
            color: t.colors.textSub,
            marginTop: t.spacing.xs,
          }}
          numberOfLines={1}>
          {item.ownerName || 'B 站 UP 主'}
        </Text>
        <Text
          style={{
            fontSize: t.fontSize.sm,
            lineHeight: 21,
            color: t.colors.textSub,
            marginTop: t.spacing.sm,
            minHeight: 42,
          }}
          numberOfLines={2}>
          {item.description?.trim() ||
            (item.kind === 'subscribedSeason'
              ? '来自你的订阅合集'
              : '来自同好的收藏夹')}
        </Text>
        {item.matchedTags.length > 0 && (
          <Text
            style={{
              fontSize: t.fontSize.xs,
              color: t.colors.textSub,
              marginTop: t.spacing.sm,
            }}
            numberOfLines={1}>
            {item.matchedTags.slice(0, 3).join(' · ')}
          </Text>
        )}
      </TouchableOpacity>
      <View style={{alignItems: 'flex-end', marginTop: t.spacing.sm}}>
        <SubscribePlaylistButton source={item} compact />
      </View>
    </View>
  );

  const renderSong = (item: TagRecommendation) => (
    <TouchableOpacity
      key={item.bvid}
      accessibilityRole="button"
      accessibilityLabel={`播放 ${item.title}，${item.author}`}
      activeOpacity={0.72}
      onPress={() => startPlayback(item)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 84,
        paddingVertical: t.spacing.md,
        borderTopWidth: 1,
        borderTopColor: glassBorder,
      }}>
      <FastImage
        source={{uri: item.cover}}
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          backgroundColor: t.colors.surfaceHigh,
        }}
        resizeMode={FastImage.resizeMode.cover}
      />
      <View style={{flex: 1, minWidth: 0, marginHorizontal: t.spacing.md}}>
        <Text
          style={{
            fontSize: t.fontSize.base,
            lineHeight: 22,
            fontWeight: '600',
            color: t.colors.text,
          }}
          numberOfLines={2}>
          {item.title}
        </Text>
        <Text
          style={{
            fontSize: t.fontSize.sm,
            color: t.colors.textSub,
            marginTop: t.spacing.xs,
          }}
          numberOfLines={1}>
          {[item.author, ...item.matchedTags.slice(0, 1)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Icon
        accessible={false}
        name="play-circle-outline"
        size={28}
        color={t.colors.primary}
      />
    </TouchableOpacity>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.glass ? 'transparent' : t.colors.background,
      }}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh('manual')}
            tintColor={t.colors.primary}
            colors={[t.colors.primary]}
          />
        }
        contentContainerStyle={{
          width: '100%',
          maxWidth: 880,
          alignSelf: 'center',
          paddingTop: Math.max(insets.top, 12) + t.spacing.md,
          paddingHorizontal: t.spacing.xl,
          paddingBottom: 24,
        }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: t.spacing.xl,
          }}>
          <View style={{flex: 1, minWidth: 0, marginRight: t.spacing.md}}>
            <Text
              style={{
                fontSize: t.fontSize.sm,
                fontWeight: '600',
                color: t.colors.primary,
                marginBottom: t.spacing.xs,
              }}>
              NYAMI · 为你而选
            </Text>
            <Text
              accessibilityRole="header"
              style={{
                fontSize: 28,
                lineHeight: 38,
                fontWeight: '700',
                color: t.colors.text,
              }}>
              发现好音乐
            </Text>
            <Text
              style={{
                fontSize: t.fontSize.sm,
                lineHeight: 21,
                color: t.colors.textSub,
                marginTop: t.spacing.xs,
              }}>
              从熟悉的收藏，听见新的喜欢。
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="查看用户画像"
            activeOpacity={0.75}
            onPress={() => navigation.navigate('TagRecommendations')}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.colors.surfaceHigh,
              borderWidth: 1,
              borderColor: glassBorder,
            }}>
            {showAvatar ? (
              <FastImage
                source={{uri: avatarUrl}}
                style={{width: 48, height: 48}}
                resizeMode={FastImage.resizeMode.cover}
                onError={() => setFailedAvatarUrl(avatarUrl)}
              />
            ) : (
              <Icon
                accessible={false}
                name="account-outline"
                size={26}
                color={t.colors.textSub}
              />
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="搜索 B 站视频或收藏"
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}>
          <GlassView
            borderRadius={18}
            backgroundColor={glassBackground}
            borderColor={glassBorder}
            noShadow
            noBlur
            minimal>
            <View
              style={{
                minHeight: 56,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: t.spacing.lg,
                paddingVertical: t.spacing.md,
              }}>
              <Icon
                accessible={false}
                name="magnify"
                size={24}
                color={t.colors.textSub}
              />
              <Text
                style={{
                  flex: 1,
                  marginLeft: t.spacing.md,
                  color: t.colors.textSub,
                  fontSize: t.fontSize.base,
                }}>
                搜索喜欢的视频、音乐
              </Text>
              <Icon
                accessible={false}
                name="chevron-right"
                size={20}
                color={t.colors.textSub}
              />
            </View>
          </GlassView>
        </TouchableOpacity>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: t.spacing.md,
            marginBottom: t.spacing.xxl,
          }}>
          <View
            style={{flex: 1, minWidth: 0, paddingRight: t.spacing.sm}}
            accessibilityLiveRegion="polite">
            <Text
              style={{
                fontSize: t.fontSize.sm,
                lineHeight: 20,
                color: t.colors.textSub,
              }}>
              {refreshing
                ? '正在为你更新推荐…'
                : feed.updatedAt
                ? `最近更新 ${updateTimeLabel(feed.updatedAt)}`
                : '首页打开时生成推荐'}
            </Text>
            <Text
              style={{
                fontSize: t.fontSize.xs,
                lineHeight: 19,
                color: t.colors.textSub,
                marginTop: 2,
              }}>
              {homeRefreshMode === 'automatic'
                ? `每 ${homeRefreshIntervalHours} 小时自动更新`
                : '手动更新 · 下拉可刷新'}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="刷新首页推荐"
            accessibilityState={{
              disabled: !uid || refreshing,
              busy: refreshing,
            }}
            activeOpacity={0.7}
            disabled={!uid || refreshing}
            onPress={() => void refresh('manual')}
            style={{
              minHeight: 48,
              minWidth: 48,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: t.spacing.xs,
              paddingHorizontal: t.spacing.md,
              borderRadius: 14,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: glassBorder,
              opacity: !uid || refreshing ? 0.5 : 1,
            }}>
            {refreshing ? (
              <ActivityIndicator size="small" color={t.colors.primary} />
            ) : (
              <Icon
                accessible={false}
                name="refresh"
                size={20}
                color={t.colors.primary}
              />
            )}
            <Text
              style={{
                fontSize: t.fontSize.sm,
                color: t.colors.primary,
                fontWeight: '600',
              }}>
              刷新
            </Text>
          </TouchableOpacity>
        </View>

        {feed.error && (
          <View
            accessibilityLiveRegion="polite"
            style={{
              padding: t.spacing.lg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: t.colors.divider,
              backgroundColor: t.colors.surface,
              marginBottom: t.spacing.xl,
            }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: t.spacing.sm,
              }}>
              <Icon
                accessible={false}
                name="alert-circle-outline"
                size={20}
                color={t.colors.error}
              />
              <Text
                style={{
                  flex: 1,
                  fontSize: t.fontSize.sm,
                  lineHeight: 21,
                  color: t.colors.text,
                }}>
                {feed.error}
              </Text>
            </View>
            {!refreshing && (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.7}
                onPress={() => void refresh('manual')}
                style={{
                  minHeight: 48,
                  justifyContent: 'center',
                  alignSelf: 'flex-start',
                }}>
                <Text
                  style={{
                    fontSize: t.fontSize.sm,
                    fontWeight: '600',
                    color: t.colors.primary,
                  }}>
                  重新加载推荐
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{marginBottom: t.spacing.xxl}}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: t.spacing.sm,
            }}>
            <Text
              accessibilityRole="header"
              style={{
                flex: 1,
                color: t.colors.text,
                fontSize: t.fontSize.xl,
                fontWeight: '700',
              }}>
              同好珍藏
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="查看全部推荐合集与收藏夹"
              activeOpacity={0.7}
              onPress={() => navigation.navigate('PlaylistRecommendations')}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
              }}>
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
                查看全部
              </Text>
              <Icon
                accessible={false}
                name="chevron-right"
                size={20}
                color={t.colors.textSub}
              />
            </TouchableOpacity>
          </View>
          <Text
            style={{
              fontSize: t.fontSize.sm,
              lineHeight: 21,
              color: t.colors.textSub,
              marginBottom: t.spacing.lg,
            }}>
            从你收藏的他人歌单与订阅合集中挑选
          </Text>
          {previewCollections.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {previewCollections.map(renderCollectionCard)}
            </ScrollView>
          ) : (
            <View
              style={{
                padding: t.spacing.xl,
                borderRadius: 20,
                backgroundColor: glassBackground,
                borderWidth: 1,
                borderColor: glassBorder,
                alignItems: 'center',
              }}>
              {refreshing ? (
                <ActivityIndicator color={t.colors.primary} />
              ) : (
                <Icon
                  accessible={false}
                  name="playlist-music-outline"
                  size={32}
                  color={t.colors.textSub}
                />
              )}
              <Text
                style={{
                  fontSize: t.fontSize.base,
                  lineHeight: 23,
                  color: t.colors.text,
                  textAlign: 'center',
                  marginTop: t.spacing.md,
                }}>
                {refreshing ? '正在整理收藏夹与合集…' : '好歌单，从收藏开始'}
              </Text>
              {!refreshing && (
                <>
                  <Text
                    style={{
                      fontSize: t.fontSize.sm,
                      lineHeight: 21,
                      textAlign: 'center',
                      color: t.colors.textSub,
                      marginTop: t.spacing.xs,
                    }}>
                    收藏喜欢的他人歌单后，这里会为你精选推荐。
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('VisibleFolders')}
                    style={{
                      minHeight: 48,
                      justifyContent: 'center',
                      marginTop: t.spacing.sm,
                    }}>
                    <Text
                      style={{
                        fontSize: t.fontSize.sm,
                        color: t.colors.primary,
                        fontWeight: '600',
                      }}>
                      管理播放列表偏好
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>

        <View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: t.spacing.sm,
            }}>
            <Text
              accessibilityRole="header"
              style={{
                flex: 1,
                fontSize: t.fontSize.xl,
                fontWeight: '700',
                color: t.colors.text,
              }}>
              此刻想听
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="查看全部歌曲推荐"
              activeOpacity={0.7}
              onPress={() => navigation.navigate('SongRecommendations')}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
              }}>
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
                查看全部
              </Text>
              <Icon
                accessible={false}
                name="chevron-right"
                size={20}
                color={t.colors.textSub}
              />
            </TouchableOpacity>
          </View>
          <Text
            style={{
              fontSize: t.fontSize.sm,
              lineHeight: 21,
              color: t.colors.textSub,
              marginBottom: t.spacing.md,
            }}>
            根据你的兴趣标签，发现下一首喜欢
          </Text>
          {previewSongs.length > 0 ? (
            <GlassView
              borderRadius={20}
              backgroundColor={glassBackground}
              borderColor={glassBorder}
              noShadow
              noBlur
              minimal>
              <View style={{paddingHorizontal: t.spacing.lg}}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="播放全部推荐歌曲"
                  activeOpacity={0.7}
                  onPress={() => startPlayback(previewSongs[0])}
                  style={{
                    minHeight: 56,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: t.spacing.sm,
                  }}>
                  <Icon
                    accessible={false}
                    name="play-circle"
                    size={26}
                    color={t.colors.primary}
                  />
                  <Text
                    style={{
                      fontSize: t.fontSize.base,
                      fontWeight: '600',
                      color: t.colors.primary,
                    }}>
                    播放推荐
                  </Text>
                  <Text
                    style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
                    · {previewSongs.length} 首精选
                  </Text>
                </TouchableOpacity>
                {previewSongs.map(renderSong)}
              </View>
            </GlassView>
          ) : (
            <View
              style={{
                padding: t.spacing.xl,
                borderRadius: 20,
                backgroundColor: glassBackground,
                borderWidth: 1,
                borderColor: glassBorder,
                alignItems: 'center',
              }}>
              {refreshing ? (
                <ActivityIndicator color={t.colors.primary} />
              ) : (
                <Icon
                  accessible={false}
                  name="music-note-outline"
                  size={32}
                  color={t.colors.textSub}
                />
              )}
              <Text
                style={{
                  fontSize: t.fontSize.base,
                  lineHeight: 23,
                  color: t.colors.text,
                  textAlign: 'center',
                  marginTop: t.spacing.md,
                }}>
                {refreshing ? '正在根据你的画像找歌…' : '让推荐更懂你的喜好'}
              </Text>
              {!refreshing && (
                <>
                  <Text
                    style={{
                      fontSize: t.fontSize.sm,
                      lineHeight: 21,
                      color: t.colors.textSub,
                      textAlign: 'center',
                      marginTop: t.spacing.xs,
                    }}>
                    同步收藏并读取兴趣标签，即可生成歌曲推荐。
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('TagRecommendations')}
                    style={{
                      minHeight: 48,
                      justifyContent: 'center',
                      marginTop: t.spacing.sm,
                    }}>
                    <Text
                      style={{
                        fontSize: t.fontSize.sm,
                        fontWeight: '600',
                        color: t.colors.primary,
                      }}>
                      查看用户画像
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
          {feed.failedSearchCount > 0 && (
            <Text
              style={{
                fontSize: t.fontSize.sm,
                lineHeight: 21,
                color: t.colors.textSub,
                marginTop: t.spacing.md,
              }}>
              部分兴趣标签搜索失败，稍后刷新可重试。
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
};
