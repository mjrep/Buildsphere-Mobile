import React from 'react';
import { View } from 'react-native';
import SkeletonBox from './SkeletonBox';
import SkeletonCard from './SkeletonCard';
import SkeletonText from './SkeletonText';

export default function TaskCardSkeleton() {
  return (
    <SkeletonCard>
      <View className="flex-row">
        <SkeletonBox width={5} height={86} borderRadius={999} style={{ marginRight: 14 }} />
        <View className="flex-1">
          <View className="mb-3 flex-row items-start justify-between">
            <View className="flex-1">
              <SkeletonText width="82%" height={15} />
              <SkeletonText width="62%" height={11} style={{ marginTop: 10 }} />
            </View>
            <SkeletonBox width={68} height={24} borderRadius={999} />
          </View>
          <View className="mt-2 flex-row items-center justify-between">
            <SkeletonText width={95} height={11} />
            <SkeletonText width={70} height={11} />
          </View>
        </View>
      </View>
    </SkeletonCard>
  );
}
