/**
 * Image URL helpers
 *
 * Normalizes legacy single image paths and newer JSON/array photo fields into a
 * predictable list for site updates, task evidence, and inventory thumbnails.
 */
export function getImageUrls(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((item) => getImageUrls(item))));
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

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return getImageUrls([
      record.url,
      record.uri,
      record.path,
      record.image_url,
      record.photo_url,
      record.evidence_image_path,
      record.image_urls,
      record.images,
      record.attachments,
    ]);
  }

  return [];
}

export function normalizeImageUrl(value: unknown): string | null {
  return getImageUrls(value)[0] || null;
}

export function getSiteProgressImages(record: unknown): string[] {
  if (!record || typeof record !== 'object') return getImageUrls(record);

  const siteProgress = record as Record<string, unknown>;
  // NOTE: Site uploads can contain multiple photos.
  // image_url is kept for backward compatibility, while image_urls/images stores all uploaded photos.
  return getImageUrls([
    siteProgress.image_urls,
    siteProgress.images,
    siteProgress.attachments,
    siteProgress.image_url,
    siteProgress.photo_url,
    siteProgress.evidence_image_path,
  ]);
}
