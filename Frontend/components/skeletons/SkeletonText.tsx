import React from 'react';
import { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import SkeletonBox from './SkeletonBox';

interface SkeletonTextProps {
  width?: DimensionValue;
  height?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}

export default function SkeletonText({ width = '70%', height = 12, style }: SkeletonTextProps) {
  return <SkeletonBox width={width} height={height} borderRadius={999} style={style} />;
}
