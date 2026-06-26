import React from 'react';
import { View } from 'react-native';
import SkeletonBox from './SkeletonBox';
import SkeletonCard from './SkeletonCard';
import SkeletonText from './SkeletonText';

export default function NotificationSkeleton() {
  return (
    <SkeletonCard style={{ borderRadius: 20, padding: 20 }}>
      <View className="flex-row items-start">
        <SkeletonBox width={44} height={44} borderRadius={15} style={{ marginRight: 16 }} />
        <View className="flex-1">
          <SkeletonText width="70%" height={14} />
          <SkeletonText width="96%" height={11} style={{ marginTop: 12 }} />
          <SkeletonText width="74%" height={11} style={{ marginTop: 8 }} />
          <SkeletonText width={80} height={10} style={{ marginTop: 14 }} />
        </View>
      </View>
    </SkeletonCard>
  );
}
