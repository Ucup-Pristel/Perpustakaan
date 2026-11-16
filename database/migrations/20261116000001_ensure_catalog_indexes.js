'use strict';

// Older PostgreSQL installations already recorded baseline_schema before its
// SQLite-only index creation was corrected. Editing that migration cannot
// upgrade those databases; apply the repair under a new migration identity.
exports.up = async function up(knex) {
  for (const [name, table, columns] of [
    ['contents_sub_field_level_idx', 'contents', ['sub_field_id', 'level']],
    ['notes_user_idx', 'notes', ['user_id']],
    ['reading_progress_user_idx', 'reading_progress', ['user_id']],
  ]) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (${columns.map(() => '??').join(', ')})`,
      [name, table, ...columns]);
  }
};

// These indexes also belong to the baseline and may predate this repair.
// Removing them here would damage an otherwise unchanged existing database.
exports.down = async function down() {};
