const EMPTY_LABEL = '-';
const ACRONYMS = new Set(['AI', 'API', 'CEO', 'COO', 'HR', 'ID', 'QA', 'QC', 'UI', 'UX']);

export function formatDisplayLabel(value: unknown, fallback = EMPTY_LABEL) {
  if (value === null || value === undefined) return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  const normalized = raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return fallback;

  return normalized
    .split(' ')
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function normalizeDisplayKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}
