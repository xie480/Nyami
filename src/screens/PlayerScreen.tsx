import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {useShallow} from 'zustand/react/shallow';
import TrackPlayer, {
  State,
  useActiveTrack,
  usePlaybackState,
} from 'react-native-track-player';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {IconButton} from '../components/IconButton';
import {FavoriteFolderPickerSheet} from '../components/FavoriteFolderPickerSheet';
import {ProgressBar} from '../components/ProgressBar';
import {AlbumBackground} from '../components/player/AlbumBackground';
import {PlaybackControls} from '../components/player/PlaybackControls';
import {PlayerActionPanel} from '../components/player/PlayerActionPanel';
import {PlayerMoreSheet} from '../components/player/PlayerMoreSheet';
import {SleepTimerSheet} from '../components/player/SleepTimerSheet';
import {TrackInfo} from '../components/player/TrackInfo';
import {VinylRecord} from '../components/player/VinylRecord';
import {AUDIO_REACTIVE_RING_LAYOUT_GROWTH} from '../components/player/AudioReactiveRing';
import {
  pausePlayback,
  playSpecificPart,
  resumePlayback,
  retryCurrentTrack,
  skipToNext,
  skipToPrevious,
} from '../services/trackPlayer';
import {scheduleSleepTimer} from '../services/sleepTimer';
import {createBilibiliVideoUrl} from '../utils/bilibiliVideoUrl';
import {useTheme} from '../theme';
import {useAlbumTheme} from '../hooks/useAlbumTheme';
import {useSettingsStore} from '../store/settingsStore';
import {usePlayerStore} from '../store/playerStore';
import {useSyncStore} from '../store/syncStore';
import {useProgressStore} from '../store/progressStore';
import {useUIStore} from '../store/uiStore';
import type {OnlineVideoSearchResult} from '../types/domain';

export const PlayerScreen = () => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const {width: screenWidth, height: screenHeight} = useWindowDimensions();

  const {
    storeQueue,
    storeCurrentBvid,
    currentCid,
    isResolving,
    playbackError,
    playMode,
    togglePlayMode,
  } = usePlayerStore(
    useShallow(state => ({
      storeQueue: state.queue,
      storeCurrentBvid: state.currentBvid,
      currentCid: state.currentCid,
      isResolving: state.isResolving,
      playbackError: state.playbackError,
      playMode: state.playMode,
      togglePlayMode: state.togglePlayMode,
    })),
  );

  const {fallbackTrack, fallbackDuration} = useMemo(() => {
    const current = storeQueue.find(video => video.bvid === storeCurrentBvid);
    return {
      fallbackTrack: current
        ? {
            id: current.bvid,
            title: current.title,
            artist: current.upper?.name || '未知歌手',
            artwork: current.cover,
            duration: current.duration,
          }
        : null,
      fallbackDuration: current?.duration ?? 0,
    };
  }, [storeQueue, storeCurrentBvid]);

  const {progressPosition, progressDuration} = useProgressStore(
    useShallow(state => ({
      progressPosition: state.position,
      progressDuration: state.duration,
    })),
  );
  const cachePersonalizedRecommendations = useSettingsStore(
    state => state.cachePersonalizedRecommendations,
  );
  const setCachePersonalizedRecommendations = useSettingsStore(
    state => state.setCachePersonalizedRecommendations,
  );
  const playerArtworkBlurAmount = useSettingsStore(
    state => state.playerArtworkBlurAmount,
  );
  const setPlayerArtworkBlurAmount = useSettingsStore(
    state => state.setPlayerArtworkBlurAmount,
  );
  const syncStatus = useSyncStore(state => state.syncStatus);
  const isPersonalized = usePlayerStore(
    state => !!state.playContext?.isPersonalized,
  );
  const activeTrack = useActiveTrack();
  const playback = usePlaybackState();

  const [isMoreSheetVisible, setIsMoreSheetVisible] = useState(false);
  const [isSleepTimerSheetVisible, setIsSleepTimerSheetVisible] =
    useState(false);
  const [favoritePickerVisible, setFavoritePickerVisible] = useState(false);
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false);
  const [isAppActive, setIsAppActive] = useState(
    AppState.currentState === 'active',
  );
  const isMotionActive = isFocused && isAppActive;

  const track =
    isResolving && activeTrack?.id !== storeCurrentBvid
      ? (fallbackTrack as any) || null
      : activeTrack || (fallbackTrack as any) || null;
  const trackId = track?.id;
  const currentVideo = usePlayerStore(
    useShallow(state =>
      trackId ? state.queue.find(video => video.bvid === trackId) : undefined,
    ),
  );
  const favoriteTarget = useMemo<OnlineVideoSearchResult | null>(() => {
    if (!currentVideo) {
      return null;
    }
    return {
      aid: currentVideo.aid ?? 0,
      bvid: currentVideo.bvid,
      title: currentVideo.title,
      cover: currentVideo.cover,
      duration: currentVideo.duration,
      pubtime: currentVideo.pubtime,
      authorId: currentVideo.upper.mid,
      author: currentVideo.upper.name,
      tags: [],
    };
  }, [currentVideo]);
  const currentVideoUrl = createBilibiliVideoUrl(currentVideo?.bvid);
  const openCurrentVideoOnBilibili = useCallback(async () => {
    if (!currentVideoUrl) {
      return;
    }

    setIsMoreSheetVisible(false);
    try {
      await Linking.openURL(currentVideoUrl);
    } catch {
      Alert.alert('无法打开视频', '请检查设备是否可以打开 B 站视频链接。');
    }
  }, [currentVideoUrl]);

  const artworkUri =
    typeof track?.artwork === 'string' ? track.artwork : undefined;
  const albumTheme = useAlbumTheme(
    artworkUri,
    t.colors.primary,
    isMotionActive,
  );
  const statusBarStyle =
    albumTheme.foreground === '#17191E' ? 'dark-content' : 'light-content';
  const duration = progressDuration || fallbackDuration;
  const isPlaying = playback.state === State.Playing;
  const trackUrl = track?.url;
  const isPlaceholder =
    typeof trackUrl === 'string' && trackUrl.startsWith('placeholder://');
  const isBuffering =
    !isPlaceholder &&
    (playback.state === State.Buffering || playback.state === State.Loading);
  const statusBarHeight =
    Platform.OS === 'android'
      ? Math.max(insets.top, StatusBar.currentHeight ?? 0)
      : insets.top;
  const availableHeight = Math.max(
    0,
    screenHeight - statusBarHeight - insets.bottom,
  );
  const reservedHeight = 348 + AUDIO_REACTIVE_RING_LAYOUT_GROWTH;
  const recordSize = Math.max(
    154,
    Math.min(screenWidth * 0.74, (availableHeight - reservedHeight) * 0.73),
  );
  const seekDuration = progressDuration || duration;
  const hasResetProgressOnFocus = useRef(false);
  useFocusEffect(
    React.useCallback(() => {
      if (!hasResetProgressOnFocus.current) {
        if (isResolving) {
          useProgressStore.getState().resetProgress();
        }
        hasResetProgressOnFocus.current = true;
      }
      return () => {
        hasResetProgressOnFocus.current = false;
      };
    }, [isResolving]),
  );

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) {
        setIsReduceMotionEnabled(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setIsReduceMotionEnabled,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setIsAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const onSeekEnd = useCallback((progress: number) => {
    TrackPlayer.seekTo(progress * seekDuration);
  }, [seekDuration]);

  const onSetPlayMode = (mode: 'sequential' | 'shuffle') => {
    if (syncStatus !== 'syncing' && mode !== playMode) {
      togglePlayMode();
    }
  };

  if (!track) {
    return (
      <View style={[styles.loading, {backgroundColor: t.colors.background}]}>
        <StatusBar
          barStyle={statusBarStyle}
          translucent
          backgroundColor="transparent"
        />
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        {backgroundColor: albumTheme.effectiveBackgroundColor},
      ]}>
      <StatusBar
        barStyle={statusBarStyle}
        translucent
        backgroundColor="transparent"
      />
      <AlbumBackground
        artworkUri={artworkUri}
        theme={albumTheme}
        isVisible={isMotionActive}
        blurAmount={playerArtworkBlurAmount}
      />

      <ScrollView
        style={styles.contentScroll}
        contentContainerStyle={[
          styles.content,
          {
            minHeight: availableHeight,
            paddingTop: statusBarHeight + 2,
            paddingBottom: Math.max(8, insets.bottom + 8),
            paddingHorizontal: Math.min(26, screenWidth * 0.062),
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}>
        <View style={styles.header}>
          <IconButton
            name="chevron-down"
            size={28}
            color={albumTheme.foreground}
            accessibilityLabel="关闭播放详情"
            onPress={() => navigation.goBack()}
            style={styles.headerButton}
          />
          <View style={styles.headerCopy}>
            <Text
              style={[
                styles.headerEyebrow,
                {color: albumTheme.secondaryForeground},
              ]}>
              NOW PLAYING
            </Text>
            <Text style={[styles.headerLabel, {color: albumTheme.foreground}]}>
              正在播放
            </Text>
          </View>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.recordSlot}>
          <VinylRecord
            artworkUri={artworkUri}
            size={recordSize}
            isPlaying={isPlaying}
            isVisible={isMotionActive}
            reduceMotion={isReduceMotionEnabled}
            theme={albumTheme}
          />
        </View>

        <TrackInfo
          title={track.title || '未知歌曲'}
          artist={track.artist || '未知歌手'}
          theme={albumTheme}
          onFavorite={
            isPersonalized && favoriteTarget
              ? () => setFavoritePickerVisible(true)
              : undefined
          }
        />

        <View style={styles.progressSection}>
          <ProgressBar
            progress={seekDuration > 0 ? progressPosition / seekDuration : 0}
            position={progressPosition}
            duration={seekDuration}
            colors={[albumTheme.primaryAccent, albumTheme.secondaryAccent]}
            trackColor="rgba(255,255,255,0.34)"
            thumbColor={albumTheme.primaryAccent}
            timeColor={albumTheme.secondaryForeground}
            onSeekEnd={onSeekEnd}
          />
        </View>

        {playbackError ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${playbackError}，点击重试`}
            onPress={() => retryCurrentTrack()}
            style={styles.playbackError}>
            <Text style={styles.playbackErrorText}>
              {playbackError} · 点击重试
            </Text>
          </TouchableOpacity>
        ) : null}

        <PlaybackControls
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          isResolving={isResolving}
          playMode={playMode}
          theme={albumTheme}
          onPlayPause={() => (isPlaying ? pausePlayback() : resumePlayback())}
          onPrevious={skipToPrevious}
          onNext={skipToNext}
          onSetMode={onSetPlayMode}
          modeDisabled={syncStatus === 'syncing'}
        />

        <PlayerActionPanel
          theme={albumTheme}
          onQueue={() => useUIStore.getState().setPlaylistVisible(true)}
          onEffects={() => navigation.navigate('SoundLab')}
          onTimer={() => setIsSleepTimerSheetVisible(true)}
          onMore={() => setIsMoreSheetVisible(true)}
        />
      </ScrollView>

      <SleepTimerSheet
        visible={isSleepTimerSheetVisible}
        theme={albumTheme}
        onStart={minutes => {
          scheduleSleepTimer(minutes, () => pausePlayback());
        }}
        onClose={() => setIsSleepTimerSheetVisible(false)}
      />

      <PlayerMoreSheet
        visible={isMoreSheetVisible}
        isPersonalized={isPersonalized}
        cachePersonalizedRecommendations={cachePersonalizedRecommendations}
        blurAmount={playerArtworkBlurAmount}
        parts={currentVideo?.parts ?? []}
        bvid={currentVideo?.bvid}
        currentCid={currentCid}
        theme={albumTheme}
        onTogglePersonalizedCaching={setCachePersonalizedRecommendations}
        onBlurAmountChange={setPlayerArtworkBlurAmount}
        onOpenBilibiliVideo={openCurrentVideoOnBilibili}
        onSelectPart={part => {
          if (currentVideo) {
            playSpecificPart(currentVideo.bvid, part.cid, part.title);
          }
          setIsMoreSheetVisible(false);
        }}
        onClose={() => setIsMoreSheetVisible(false)}
      />

      <FavoriteFolderPickerSheet
        visible={favoritePickerVisible}
        video={favoriteTarget}
        onClose={() => setFavoritePickerVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {flex: 1, overflow: 'hidden'},
  contentScroll: {flex: 1},
  content: {flexGrow: 1},
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  header: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {alignItems: 'center', justifyContent: 'center'},
  headerEyebrow: {fontSize: 9, fontWeight: '700', letterSpacing: 2.4},
  headerLabel: {fontSize: 12, fontWeight: '600', marginTop: 2},
  recordSlot: {
    flex: 1,
    minHeight: 188,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressSection: {marginTop: 5},
  playbackError: {paddingVertical: 4, alignItems: 'center'},
  playbackErrorText: {color: '#FFE0DC', fontSize: 12, textAlign: 'center'},
});
