const PROJECT_AVATAR_PALETTE = [
  { backgroundColor: '#EEF2FF', textColor: '#5B5CE2', borderColor: '#D8DCFF' },
  { backgroundColor: '#FFF1E7', textColor: '#D97706', borderColor: '#FED7AA' },
  { backgroundColor: '#ECFDF5', textColor: '#059669', borderColor: '#A7F3D0' },
  { backgroundColor: '#FDF2F8', textColor: '#DB2777', borderColor: '#FBCFE8' },
  { backgroundColor: '#EFF6FF', textColor: '#2563EB', borderColor: '#BFDBFE' },
  { backgroundColor: '#F5F3FF', textColor: '#7C3AED', borderColor: '#DDD6FE' },
];

const IGNORED_INITIAL_WORDS = new Set(['the', 'and', 'of', 'for', 'at', 'in', 'on']);

// Generates a fallback project avatar using project initials.
// This keeps project cards readable even when no uploaded project logo is available.
export function getProjectInitials(projectName?: string | null) {
  const normalizedName = String(projectName || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedName) return 'PR';

  const words = normalizedName
    .split(' ')
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  const importantWords = words.filter((word) => !IGNORED_INITIAL_WORDS.has(word.toLowerCase()));
  const sourceWords = importantWords.length > 0 ? importantWords : words;

  if (sourceWords.length >= 2) {
    return `${sourceWords[0][0]}${sourceWords[1][0]}`.toUpperCase();
  }

  return (sourceWords[0] || 'PR').slice(0, 2).toUpperCase().padEnd(2, 'R');
}

export function getProjectAvatarColors(projectKey?: string | number | null) {
  const key = String(projectKey || 'project');
  const hash = key.split('').reduce((total, character) => total + character.charCodeAt(0), 0);
  return PROJECT_AVATAR_PALETTE[hash % PROJECT_AVATAR_PALETTE.length];
}
