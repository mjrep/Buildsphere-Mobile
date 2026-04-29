import { View, Text, TouchableOpacity, Image, ImageSourcePropType } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';

interface ProjectCardProps {
  name: string;
  location: string;
  color: string;
  progress?: number;
  daysLeft?: number;
  image?: ImageSourcePropType;
  onAction?: () => void;
}

export default function ProjectCard({
  name,
  location,
  color,
  progress = 0,
  daysLeft,
  image,
  onAction,
}: ProjectCardProps) {
  // Use the color directly (it's a hex code) or fallback to Soft Pink
  const bannerColor = color || '#FFD6F3';

  return (
    <View
      className="mb-6 overflow-hidden rounded-[30px] bg-white pb-4"
      style={{
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 5 },
        elevation: 5,
      }}>
      {/* Banner */}
      <View style={{ backgroundColor: bannerColor, height: 180 }}>
        {image && (
          <Image
            source={image}
            className="absolute inset-0 h-full w-full"
            resizeMode="cover"
          />
        )}
        {/* 3-dot menu */}
        <TouchableOpacity 
          className="absolute right-3 top-3 h-7 w-7 items-center justify-center rounded-full bg-black/10" 
          onPress={onAction}
        >
          <Ionicons name="ellipsis-vertical" size={15} color={image ? 'white' : '#666'} />
        </TouchableOpacity>
      </View>

      {/* Card Content */}
      <View className="px-5 pt-4">
        <View className="flex-row items-center mb-3">
          {/* Icon Circle */}
          <View 
            style={{ backgroundColor: `${bannerColor}26` }} // 26 is ~15% opacity in hex
            className="mr-3 h-10 w-10 items-center justify-center rounded-full"
          >
            <FontAwesome5 name="building" size={20} color={bannerColor} />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-[14px] font-bold text-[#1E1E1E]">
                {name}
              </Text>

              {daysLeft !== undefined && (
                <View className="ml-2 flex-row items-center rounded-md bg-[#EAE8FF] px-1.5 py-0.5">
                  <Ionicons name="time-outline" size={7} color="#6C63FF" />
                  <Text className="ml-1 text-[10px] font-bold text-[#6C63FF]">
                    {daysLeft} Days Left
                  </Text>
                </View>
              )}
            </View>
            <Text className="mt-2 text-[11px] text-[#A3A3A3]">{location}</Text>
          </View>
        </View>

        {/* Progress Section */}
        <View className="mt-2">
          <View className="h-[6px] overflow-hidden rounded-full bg-[#F0F0F0]">
            <View
              style={{ width: `${progress}%` }}
              className={`h-full rounded-full ${progress > 0 ? 'bg-[#5DBF50]' : 'bg-[#F0F0F0]'}`}
            />
          </View>
          <Text className="mt-1 text-right text-[12px] text-[#A3A3A3]">
            {progress}%
          </Text>
        </View>
      </View>
    </View>
  );
}
