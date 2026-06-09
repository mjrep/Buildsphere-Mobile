const pool = require('../db');

function normalizeImageUrl(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    return normalizeImageUrl(value[0]);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return normalizeImageUrl(parsed[0]);
      } catch (error) {
        return trimmed;
      }
    }

    return trimmed;
  }

  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await pool.query(`
    SELECT id, evidence_image_path
    FROM task_progress_logs
    WHERE evidence_image_path LIKE '[%'
    ORDER BY id
  `);

  const fixes = result.rows
    .map((row) => ({
      id: row.id,
      before: row.evidence_image_path,
      after: normalizeImageUrl(row.evidence_image_path),
    }))
    .filter((row) => row.after && row.after !== row.before);

  if (fixes.length === 0) {
    console.log('No stringified-array site progress image paths found.');
    return;
  }

  console.log(`Found ${fixes.length} site progress image path(s) to clean:`);
  fixes.forEach((row) => {
    console.log(`- id ${row.id}`);
    console.log(`  before: ${row.before}`);
    console.log(`  after:  ${row.after}`);
  });

  if (!apply) {
    console.log('\nPreview only. Run `node Server/scripts/cleanup-site-progress-image-paths.js --apply` to update these rows.');
    return;
  }

  await pool.query('BEGIN');
  try {
    for (const row of fixes) {
      await pool.query(
        'UPDATE task_progress_logs SET evidence_image_path = $1, updated_at = NOW() WHERE id = $2',
        [row.after, row.id]
      );
    }
    await pool.query('COMMIT');
    console.log(`Updated ${fixes.length} row(s).`);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

main()
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
