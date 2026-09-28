import React from 'react';
import {Text, View} from 'react-native';
import Svg, {Circle, Line, Polygon, Text as SvgText} from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTheme} from '../theme';
import type {TagPreference, TagProfile} from '../types/domain';

const RADAR_WIDTH = 320;
const RADAR_HEIGHT = 276;
const RADAR_CENTER_X = RADAR_WIDTH / 2;
const RADAR_CENTER_Y = 137;
const RADAR_RADIUS = 82;
const RADAR_RING_LEVELS = [0.25, 0.5, 0.75, 1];
const MAX_RADAR_TAGS = 6;

function getRadarPoint(index: number, count: number, radius: number) {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return {
    x: RADAR_CENTER_X + Math.cos(angle) * radius,
    y: RADAR_CENTER_Y + Math.sin(angle) * radius,
  };
}

function truncateTagName(tagName: string): string {
  return tagName.length > 7 ? `${tagName.slice(0, 6)}…` : tagName;
}

export const TagProfileRadar = ({preferences}: {preferences: TagPreference[]}) => {
  const t = useTheme();
  const dimensions = preferences.slice(0, MAX_RADAR_TAGS);
  if (dimensions.length === 0) return null;

  const maxCount = Math.max(1, ...dimensions.map(item => item.videoCount));
  const axisCount = dimensions.length;
  const ringPoints = (scale: number) => dimensions
    .map((_, index) => getRadarPoint(index, axisCount, RADAR_RADIUS * scale))
    .map(point => `${point.x},${point.y}`)
    .join(' ');
  const dataPoints = dimensions.map((item, index) => getRadarPoint(
    index,
    axisCount,
    RADAR_RADIUS * Math.max(0.12, item.videoCount / maxCount),
  ));

  return (
    <View style={{alignItems: 'center', marginTop: t.spacing.sm}}>
      <Svg
        width="100%"
        height={RADAR_HEIGHT}
        viewBox={`0 0 ${RADAR_WIDTH} ${RADAR_HEIGHT}`}
        accessible
        accessibilityLabel={`兴趣雷达图，展示 ${dimensions.map(item => item.tagName).join('、')}`}>
        {RADAR_RING_LEVELS.map(level => (
          <Polygon
            key={level}
            points={ringPoints(level)}
            fill="none"
            stroke={t.colors.divider}
            strokeWidth={1}
          />
        ))}
        {dimensions.map((item, index) => {
          const endPoint = getRadarPoint(index, axisCount, RADAR_RADIUS);
          const labelPoint = getRadarPoint(index, axisCount, RADAR_RADIUS + 27);
          const horizontalPosition = labelPoint.x - RADAR_CENTER_X;
          const verticalPosition = labelPoint.y - RADAR_CENTER_Y;
          const textAnchor = horizontalPosition < -12
            ? 'end'
            : horizontalPosition > 12
              ? 'start'
              : 'middle';
          return (
            <React.Fragment key={`${item.tagId}:${item.tagName}`}>
              <Line
                x1={RADAR_CENTER_X}
                y1={RADAR_CENTER_Y}
                x2={endPoint.x}
                y2={endPoint.y}
                stroke={t.colors.divider}
                strokeWidth={1}
              />
              <SvgText
                x={labelPoint.x}
                y={labelPoint.y + (verticalPosition > 12 ? 4 : -3)}
                fill={t.colors.textSub}
                fontSize={10}
                textAnchor={textAnchor}>
                {truncateTagName(item.tagName)}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Polygon
          points={dataPoints.map(point => `${point.x},${point.y}`).join(' ')}
          fill={t.colors.primary}
          fillOpacity={0.22}
          stroke={t.colors.primary}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        {dataPoints.map((point, index) => (
          <Circle
            key={`${dimensions[index].tagId}:${dimensions[index].tagName}`}
            cx={point.x}
            cy={point.y}
            r={4}
            fill={t.colors.primary}
            stroke={t.colors.surface}
            strokeWidth={2}
          />
        ))}
      </Svg>
      <View style={{flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: -t.spacing.xs}}>
        <Icon name="chart-arc" size={15} color={t.colors.primary} />
        <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs, marginLeft: t.spacing.xs}}>
          展示收藏视频中出现频率最高的 {dimensions.length} 个标签
        </Text>
      </View>
    </View>
  );
};

export const TagProfilePipeline = ({
  profile,
}: {
  profile: TagProfile;
}) => {
  const t = useTheme();
  const steps = [
    {title: '收藏视频', detail: '作为画像分析的数据源', value: `${profile.totalVideoCount} 个`, icon: 'heart-multiple-outline'},
    {title: '标签解析', detail: `${profile.taggedVideoCount} 个视频含可用标签`, value: `${profile.resolvedVideoCount}/${profile.totalVideoCount}`, icon: 'tag-multiple-outline'},
    {title: '兴趣维度', detail: '按标签覆盖频次形成偏好', value: `${profile.preferences.length} 项`, icon: 'chart-timeline-variant'},
  ] as const;

  return (
    <View style={{marginTop: t.spacing.lg}}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <View key={step.title} style={{flexDirection: 'row', minHeight: isLast ? 60 : 70}}>
            <View style={{width: 38, alignItems: 'center'}}>
              <View style={{width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.primaryLight}}>
                <Icon name={step.icon} size={16} color={t.colors.primary} />
              </View>
              {!isLast && <View style={{width: 2, flex: 1, marginVertical: 3, borderRadius: 1, backgroundColor: t.colors.primaryLight}} />}
            </View>
            <View style={{flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: isLast ? 0 : t.spacing.md}}>
              <View style={{flex: 1, paddingTop: 2}}>
                <Text style={{color: t.colors.text, fontSize: t.fontSize.sm, fontWeight: '600'}}>{step.title}</Text>
                <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs, marginTop: 3}}>{step.detail}</Text>
              </View>
              <Text style={{color: t.colors.primary, fontSize: t.fontSize.sm, fontWeight: '700', marginLeft: t.spacing.sm, paddingTop: 3}}>{step.value}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};
