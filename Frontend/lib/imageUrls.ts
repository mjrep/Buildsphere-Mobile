export function getImageUrls(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return getImageUrls(parsed);
      } catch (error) {
        return [trimmed];
      }
    }

    return [trimmed];
  }

  return [];
}

export function normalizeImageUrl(value: unknown): string | null {
  return getImageUrls(value)[0] || null;
}
