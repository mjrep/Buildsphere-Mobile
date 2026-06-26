import React from 'react';
import { View } from 'react-native';
import SkeletonBox from './SkeletonBox';
import SkeletonCard from './SkeletonCard';
import SkeletonText from './SkeletonText';

export function InventoryItemSkeleton() {
  return (
    <SkeletonCard>
      <View className="mb-3 flex-row items-start justify-between">
        <View className="flex-1">
          <SkeletonText width="76%" height={15} />
          <SkeletonText width={90} height={11} style={{ marginTop: 10 }} />
        </View>
        <SkeletonBox width={82} height={22} borderRadius={999} />
      </View>
      <View className="flex-row justify-between">
        <SkeletonText width={110} height={12} />
        <SkeletonText width={92} height={12} />
      </View>
      <SkeletonText width={120} height={12} style={{ marginTop: 10 }} />
    </SkeletonCard>
  );
}

export function InventoryLogSkeleton() {
  return (
    <View className="mb-2 flex-row">
      <View className="mr-4 items-center">
        <SkeletonBox width={40} height={40} borderRadius={20} />
        <SkeletonBox width={2} height={70} borderRadius={1} style={{ marginTop: 8 }} />
      </View>
      <SkeletonCard style={{ flex: 1 }}>
        <View className="mb-3 flex-row justify-between">
          <SkeletonText width="56%" height={15} />
          <SkeletonBox width={72} height={22} borderRadius={999} />
        </View>
        <SkeletonText width="88%" height={11} />
        <SkeletonText width="72%" height={11} style={{ marginTop: 9 }} />
        <View className="mt-4 flex-row justify-between">
          <SkeletonText width={94} height={10} />
          <SkeletonText width={72} height={10} />
        </View>
      </SkeletonCard>
    </View>
  );
}
