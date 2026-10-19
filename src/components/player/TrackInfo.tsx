import React from 'react';
import {ActivityIndicator, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {IconButton} from '../IconButton';
import {AlbumTheme} from '../../utils/albumTheme';

interface Props {
  title: string;
  artist: string;
  theme: AlbumTheme;
  onFavorite?: () => void;
  isFavorited?: boolean;
  favoriteLoading?: boolean;
  compact?: boolean;
  favoriteAccessibilityLabel?: string;
}

export const TrackInfo: React.FC<Props> = ({
  title,
  artist,
  theme,
  onFavorite,
  isFavorited = false,
  favoriteLoading = false,
  compact = false,
  favoriteAccessibilityLabel = '已收藏，管理当前歌曲的收藏',
}) => (
  <View style={[styles.row, compact && styles.compactRow]}>
    <View style={styles.copy}>
      <Text
        accessibilityLabel={title || '未知歌曲'}
        style={[styles.title, compact && styles.compactTitle, {color: theme.foreground}]}
        numberOfLines={2}
        ellipsizeMode="tail">
        {title || '未知歌曲'}
      </Text>
      <Text
        accessibilityLabel={artist || '未知歌手'}
        style={[styles.artist, {color: theme.secondaryForeground}]}
        numberOfLines={1}
        ellipsizeMode="tail">
        {artist || '未知歌手'}
      </Text>
    </View>
    {onFavorite ? (
      isFavorited ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={favoriteAccessibilityLabel}
          accessibilityState={{disabled: favoriteLoading}}
          disabled={favoriteLoading}
          activeOpacity={0.72}
          onPress={onFavorite}
          style={styles.savedFavorite}>
          {favoriteLoading ? (
            <ActivityIndicator size="small" color={theme.primaryAccent} />
          ) : (
            <Icon name="heart" size={21} color={theme.primaryAccent} />
          )}
        </TouchableOpacity>
      ) : (
        <IconButton
          name="heart-outline"
          size={25}
          color={theme.foreground}
          accessibilityLabel="收藏当前歌曲到收藏夹"
          disabled={favoriteLoading}
          onPress={onFavorite}
          style={styles.favorite}
        />
      )
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  row: {
    minHeight: 65,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 2,
  },
  copy: {flex: 1, minWidth: 0, paddingRight: 8},
  compactRow: {minHeight: 58},
  compactTitle: {fontSize: 20, lineHeight: 25},
  title: {
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 0.1,
    lineHeight: 29,
  },
  artist: {fontSize: 14, fontWeight: '500', marginTop: 3},
  favorite: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  savedFavorite: {
    width: 48,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
