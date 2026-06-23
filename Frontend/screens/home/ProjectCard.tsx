import { View, Text, TouchableOpacity, Image, ImageSourcePropType, useWindowDimensions } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { softCardShadow } from '../../constants/theme';
import { formatDisplayLabel } from '../../utils/display';
import { getProjectStatusColor } from '../../utils/projectProgress';

interface ProjectCardProps {
  name: string;
  clientName?: string;
  color?: string;
  status?: string;
  progress?: number;
  image?: ImageSourcePropType;
  onAction?: () => void;
}

export default function ProjectCard({
  name,
  clientName,
  color,
  status,
  progress = 0,
  image,
  onAction,
}: ProjectCardProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const bannerColor = color || '#FFDFF2';
  const bannerHeight = width >= 768 ? 220 : width <= 360 ? 150 : 180;
  const safeName = String(name || '').trim() || 'Untitled Project';
  const safeClientName = String(clientName || '').trim() || 'No client set';
  const safeStatus = formatDisplayLabel(status, 'Unknown');
  const safeProgress = Math.max(0, Math.min(100, Number.isFinite(Number(progress)) ? Math.round(Number(progress)) : 0));
  const statusColor = getProjectStatusColor(status, theme);

  return (
    <View
      className="mb-6 overflow-hidden rounded-[30px] pb-4"
      style={{
        backgroundColor: theme.surface,
        ...softCardShadow,
      }}>
      <View style={{ backgroundColor: bannerColor, height: bannerHeight }}>
        {image && (
          <Image
            source={image}
            className="absolute inset-0 h-full w-full"
            resizeMode="cover"
          />
        )}
        {onAction ? (
          <TouchableOpacity
            className="absolute left-3 top-3 h-7 w-7 items-center justify-center rounded-full bg-black/10"
            onPress={onAction}
          >
            <Ionicons name="ellipsis-vertical" size={14} color={image ? 'white' : theme.text} />
          </TouchableOpacity>
        ) : null}
        <View
          className="absolute right-3 top-3 rounded-full px-3 py-1"
          style={{ backgroundColor: image ? 'rgba(255,255,255,0.9)' : `${statusColor}1A` }}
        >
          <Text className="text-[10px] font-bold" style={{ color: statusColor }} numberOfLines={1}>
            {safeStatus}
          </Text>
        </View>
      </View>

      <View className="px-5 pt-4">
        <View className="mb-3 flex-row items-center">
          <View
            style={{ backgroundColor: `${bannerColor}26` }}
            className="mr-3 h-10 w-10 items-center justify-center rounded-full"
          >
            <FontAwesome5 name="building" size={20} color={bannerColor} />
          </View>

          <View className="flex-1">
            <View className="flex-row items-start">
              <Text className="flex-1 text-[14px] font-bold" style={{ color: theme.text }} numberOfLines={2}>
                {safeName}
              </Text>
            </View>
            <Text className="mt-2 text-[11px]" style={{ color: theme.textMuted }} numberOfLines={1}>
              {safeClientName}
            </Text>
          </View>
        </View>

        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-[11px] font-bold" style={{ color: theme.textMuted }}>
            Progress
          </Text>
          <Text className="text-[13px] font-extrabold" style={{ color: statusColor }}>
            {safeProgress}%
          </Text>
        </View>

        <View className="mt-2 h-[6px] overflow-hidden rounded-full" style={{ backgroundColor: theme.border }}>
          <View
            style={{ width: `${safeProgress}%`, backgroundColor: safeProgress > 0 ? statusColor : 'transparent' }}
            className="h-full rounded-full"
          />
        </View>
      </View>
    </View>
  );
}
