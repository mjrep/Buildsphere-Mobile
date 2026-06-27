/**
 * Backend QA debug helper.
 *
 * Logs non-sensitive diagnostics outside production. Secret-like keys are
 * redacted so troubleshooting does not leak credentials or auth tokens.
 */
function qaDebug(label, details = {}) {
  if (process.env.NODE_ENV === 'production') return;

  const redacted = {};
  for (const [key, value] of Object.entries(details)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes('token') ||
      normalized.includes('authorization') ||
      normalized.includes('password') ||
      normalized.includes('secret') ||
      normalized.includes('key')
    ) {
      continue;
    }
    redacted[key] = value;
  }

  console.log(`[QA] ${label}`, redacted);
}

module.exports = { qaDebug };
