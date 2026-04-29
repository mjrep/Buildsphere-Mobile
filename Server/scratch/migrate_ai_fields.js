/**
 * Migration: Add AI detection fields to task_progress_logs table.
 *
 * Run once:  node scratch/migrate_ai_fields.js
 *
 * Adds:
 *   ai_detected_count    — raw AI panel count before human verification
 *   verified_panel_count — human-verified panel count (may differ from AI)
 *   avg_confidence       — average detection confidence (0.0–1.0)
 *   detection_mode       — 'box', 'segmentation', or 'gemini-fallback'
 *
 * These columns are nullable so existing rows are unaffected.
 */
const pool = require('../db');

async function migrate() {
  try {
    console.log('Adding AI detection columns to task_progress_logs...');

    await pool.query(`
      ALTER TABLE task_progress_logs
        ADD COLUMN IF NOT EXISTS ai_detected_count     INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS verified_panel_count   INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS avg_confidence         REAL    DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS detection_mode         VARCHAR(30) DEFAULT NULL
    `);

    console.log('✅ Migration complete. New columns added.');

    // Verify
    const res = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'task_progress_logs'
      ORDER BY ordinal_position
    `);
    console.log('\nCurrent columns:');
    res.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    pool.end();
  }
}

migrate();
