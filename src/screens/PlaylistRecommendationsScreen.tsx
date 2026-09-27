import React, {useCallback} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GlassView} from '../components/GlassView';
import {Header} from '../components/Header';
import {useHomeRecommendations} from '../hooks/useHomeRecommendations';
import {useTheme} from '../theme';
import type {CollectionRecommendation} from '../types/domain';

/** 展示首页个性化筛选出的外部收藏夹与合集，详情沿用现有视频列表路由。 */
export const PlaylistRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {uid, feed, refreshing, refresh} = useHomeRecommendations();

  useFocusEffect(
    useCallback(() => {
      void refresh('daily');
    }, [refresh]),
  );

  const openSource = useCallback((source: CollectionRecommendation) => {
    navigation.navigate('Videos', {source, title: source.title});
  }, [navigation]);

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;

  return (
    <View style={{flex: 1, backgroundColor: t.glass ? 'transparent' : t.colors.background}}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header
        title="为你推荐的合集"
        showBack
        noBorder
        right={(
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="手动刷新合集推荐"
            disabled={!uid || refreshing}
            onPress={() => void refresh('manual')}
            style={{width: 42, alignItems: 'center', opacity: refreshing ? 0.5 : 1}}>
            {refreshing ? <ActivityIndicator size="small" color={t.colors.primary} /> : <Icon name="refresh" size={22} color={t.colors.primary} />}
          </TouchableOpacity>
        )}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh('manual')}
            tintColor={t.colors.primary}
          />
        )}
        contentContainerStyle={{paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: Math.max(insets.bottom, t.spacing.xl)}}>
        <View style={{paddingHorizontal: t.spacing.xs, marginBottom: t.spacing.md}}>
          <Text style={{fontSize: t.fontSize.xxl, lineHeight: 34, fontWeight: '800', color: t.colors.text}}>
            听见同好收藏的好歌
          </Text>
          <Text style={{fontSize: t.fontSize.sm, lineHeight: 21, color: t.colors.textSub, marginTop: 5}}>
            根据你的收藏画像，从已收藏的他人歌单与订阅合集中挑选。
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.md}}>
            <Icon name="creation" size={18} color={t.colors.primary} />
            <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginLeft: 6}}>
              {refreshing ? '正在更新推荐…' : feed.updatedAt ? `今日推荐 · ${new Date(feed.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '每日自动更新一次'}
            </Text>
          </View>
        </View>

        {feed.error && (
          <View style={{padding: t.spacing.md, borderRadius: 16, marginBottom: t.spacing.md, backgroundColor: t.colors.error + '18'}}>
            <Text style={{fontSize: t.fontSize.xs, color: t.colors.error}}>{feed.error}</Text>
          </View>
        )}

        {feed.collections.map(source => (
          <TouchableOpacity
            key={source.sourceKey}
            accessibilityRole="button"
            accessibilityLabel={`打开 ${source.title}`}
            activeOpacity={0.8}
            onPress={() => openSource(source)}
            style={{marginBottom: t.spacing.md}}>
            <GlassView borderRadius={22} backgroundColor={glassBackground} borderColor={glassBorder} noShadow>
              <View style={{flexDirection: 'row', padding: t.spacing.sm}}>
                <View style={{width: 116, height: 128, borderRadius: 16, overflow: 'hidden', backgroundColor: t.colors.surfaceHigh}}>
                  {source.cover ? (
                    <FastImage source={{uri: source.cover}} style={{width: '100%', height: '100%'}} resizeMode={FastImage.resizeMode.cover} />
                  ) : (
                    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
                      <Icon name="playlist-music" size={34} color={t.colors.primary} />
                    </View>
                  )}
                  <View style={{position: 'absolute', bottom: 7, left: 7, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, backgroundColor: 'rgba(10,10,16,0.72)'}}>
                    <Icon name="play" size={13} color="#fff" />
                    <Text style={{fontSize: 10, color: '#fff', marginLeft: 3}}>{source.mediaCount}</Text>
                  </View>
                </View>
                <View style={{flex: 1, marginLeft: t.spacing.md, paddingVertical: 3}}>
                  <View style={{flexDirection: 'row', alignItems: 'flex-start'}}>
                    <Text style={{flex: 1, color: t.colors.text, fontSize: t.fontSize.base, lineHeight: 21, fontWeight: '700'}} numberOfLines={2}>
                      {source.title}
                    </Text>
                    <Icon name="chevron-right" size={21} color={t.colors.textHint} />
                  </View>
                  <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
                    {source.ownerName || 'B 站 UP 主'} · {source.kind === 'subscribedSeason' ? '订阅合集' : '他人收藏夹'}
                  </Text>
                  <Text style={{fontSize: t.fontSize.xs, lineHeight: 17, color: t.colors.textHint, marginTop: 5, flex: 1}} numberOfLines={3}>
                    {source.description?.trim() || `B 站暂未提供简介 · 收录 ${source.mediaCount} 个视频`}
                  </Text>
                  <View style={{flexDirection: 'row', flexWrap: 'wrap', marginTop: 4}}>
                    {source.matchedTags.slice(0, 3).map(tag => (
                      <View key={`${source.sourceKey}:${tag}`} style={{paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: t.colors.primaryLight, marginRight: 5, marginBottom: 3}}>
                        <Text style={{fontSize: 10, color: t.colors.primary}}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </GlassView>
          </TouchableOpacity>
        ))}

        {!refreshing && feed.collections.length === 0 && (
          <View style={{alignItems: 'center', paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.xxl}}>
            <Icon name="playlist-remove" size={38} color={t.colors.textHint} />
            <Text style={{fontSize: t.fontSize.base, color: t.colors.textSub, textAlign: 'center', marginTop: t.spacing.md}}>
              暂时没有可推荐的外部收藏夹或订阅合集
            </Text>
            <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center', marginTop: t.spacing.xs}}>
              可先在 B 站收藏喜欢的他人歌单，再手动刷新。
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('VisibleFolders')} style={{marginTop: t.spacing.md}}>
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.primary}}>管理首页播放列表偏好</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
};
