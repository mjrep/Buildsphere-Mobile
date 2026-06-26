import React from 'react';
import { View } from 'react-native';
import SkeletonBox from './SkeletonBox';
import SkeletonCard from './SkeletonCard';
import SkeletonText from './SkeletonText';

export default function ProjectCardSkeleton() {
  return (
    <SkeletonCard style={{ padding: 0, overflow: 'hidden', borderRadius: 20 }}>
      <SkeletonBox height={74} borderRadius={0} />
      <View className="p-4">
        <View className="mb-3 flex-row items-start justify-between">
          <View className="flex-1">
            <SkeletonText width="78%" height={16} />
            <SkeletonText width="58%" height={11} style={{ marginTop: 10 }} />
          </View>
          <SkeletonBox width={58} height={24} borderRadius={999} />
        </View>
        <SkeletonBox height={8} borderRadius={999} />
        <View className="mt-3 flex-row justify-between">
          <SkeletonText width={82} height={10} />
          <SkeletonText width={64} height={10} />
        </View>
      </View>
    </SkeletonCard>
  );
}
