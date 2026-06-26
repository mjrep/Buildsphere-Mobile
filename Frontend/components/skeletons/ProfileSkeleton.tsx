import React from 'react';
import { View } from 'react-native';
import SkeletonBox from './SkeletonBox';
import SkeletonCard from './SkeletonCard';
import SkeletonText from './SkeletonText';

export default function ProfileSkeleton() {
  return (
    <View>
      <View className="mb-10 mt-6 items-center">
        <SkeletonBox width={80} height={80} borderRadius={40} />
        <SkeletonText width={180} height={18} style={{ marginTop: 18 }} />
        <SkeletonText width={220} height={12} style={{ marginTop: 10 }} />
        <SkeletonText width={84} height={11} style={{ marginTop: 10 }} />
      </View>
      <SkeletonCard style={{ borderRadius: 24, padding: 24 }}>
        <View className="mb-6 flex-row justify-between">
          <View>
            <SkeletonText width={120} height={15} />
            <SkeletonText width={70} height={10} style={{ marginTop: 10 }} />
          </View>
          <SkeletonBox width={80} height={34} borderRadius={12} />
        </View>
        <View className="flex-row flex-wrap">
          {Array.from({ length: 6 }).map((_, index) => (
            <View key={index} className="mb-6 w-1/2 pr-2">
              <View className="flex-row items-center">
                <SkeletonBox width={32} height={32} borderRadius={16} style={{ marginRight: 8 }} />
                <SkeletonText width={58} height={10} />
              </View>
              <SkeletonText width="70%" height={12} style={{ marginLeft: 40, marginTop: 9 }} />
            </View>
          ))}
        </View>
      </SkeletonCard>
    </View>
  );
}
