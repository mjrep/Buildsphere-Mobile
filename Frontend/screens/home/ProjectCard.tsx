import { View, Text, TouchableOpacity, Image, ImageSourcePropType } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { softCardShadow } from '../../constants/theme';

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
  const { theme } = useAppTheme();
  // Use the color directly (it's a hex code) or fallback to pinkish default
  const bannerColor = color || '#FFDFF2';

  return (
    <View
      className="mb-6 overflow-hidden rounded-[30px] pb-4"
      style={{
        backgroundColor: theme.surface,
        ...softCardShadow,
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
        {onAction ? (
          <TouchableOpacity 
            className="absolute right-3 top-3 h-6 w-6 items-center justify-center rounded-full bg-black/10" 
            onPress={onAction}
          >
            <Ionicons name="ellipsis-vertical" size={13} color={image ? 'white' : '#000000ff'} />
          </TouchableOpacity>
        ) : null}
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
              <Text className="flex-1 text-[14px] font-bold" style={{ color: theme.text }}>
                {name}
              </Text>

              {daysLeft !== undefined && (
                <View className="ml-2 flex-row items-center rounded-md px-1.5 py-0.5" style={{ backgroundColor: theme.primaryLight }}>
                  <Ionicons name="time-outline" size={7} color={theme.primary} />
                  <Text className="ml-1 text-[10px] font-bold" style={{ color: theme.primary }}>
                    {daysLeft} Days Left
                  </Text>
                </View>
              )}
            </View>
            <Text className="mt-2 text-[11px]" style={{ color: theme.textMuted }}>{location}</Text>
          </View>
        </View>

        {/* Progress Section */}
        <View className="mt-2">
          <View className="h-[6px] overflow-hidden rounded-full" style={{ backgroundColor: theme.border }}>
            <View
              style={{ width: `${progress}%` }}
              className={`h-full rounded-full ${progress > 0 ? 'bg-[#5DBF50]' : 'bg-[#F0F0F0]'}`}
            />
          </View>
          <Text className="mt-1 text-right text-[12px]" style={{ color: theme.textMuted }}>
            {progress}%
          </Text>
        </View>
      </View>
    </View>
  );
}
