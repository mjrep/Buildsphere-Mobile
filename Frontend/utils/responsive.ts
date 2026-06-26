export const PHONE_CONTENT_MAX_WIDTH = 720;
export const FORM_CONTENT_MAX_WIDTH = 680;
export const NAV_CONTENT_MAX_WIDTH = 560;

export function horizontalPadding(width: number) {
  if (width >= 768) return 32;
  if (width <= 360) return 16;
  return 20;
}

export function centeredContent(width: number, maxWidth = PHONE_CONTENT_MAX_WIDTH) {
  const padding = horizontalPadding(width);
  return {
    width: '100%' as const,
    maxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: padding,
  };
}

export function centeredWidth(width: number, maxWidth = PHONE_CONTENT_MAX_WIDTH) {
  const padding = horizontalPadding(width);
  return Math.min(Math.max(width - padding * 2, 0), maxWidth);
}
