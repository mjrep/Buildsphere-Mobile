/**
 * QA debug helper
 *
 * Allows non-sensitive diagnostic logs during development/testing while keeping
 * production output quiet and avoiding secrets in console messages.
 */
export function qaDebug(label: string, details: Record<string, unknown> = {}) {
  if (!__DEV__) return;

  const redacted = Object.fromEntries(
    // Redact common sensitive fields before logging QA diagnostics.
    Object.entries(details).filter(([key]) => {
      const normalized = key.toLowerCase();
      return (
        !normalized.includes('token') &&
        !normalized.includes('authorization') &&
        !normalized.includes('password') &&
        !normalized.includes('secret') &&
        !normalized.includes('key')
      );
    })
  );

  console.log(`[QA] ${label}`, redacted);
}
