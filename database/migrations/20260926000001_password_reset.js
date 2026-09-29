'use strict';

/**
 * Schema password reset. Token mentah tidak pernah disimpan; hanya SHA-256-nya.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'session_version'))) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('session_version').notNullable().defaultTo(0);
    });
  }

  if (!(await knex.schema.hasTable('password_reset_tokens'))) {
    await knex.schema.createTable('password_reset_tokens', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.string('token_hash', 64).notNullable().unique();
      table.timestamp('expires_at').notNullable();
      table.timestamp('used_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['user_id'], 'password_reset_tokens_user_id_idx');
      table.index(['expires_at'], 'password_reset_tokens_expires_at_idx');
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('password_reset_tokens');
  if (await knex.schema.hasColumn('users', 'session_version')) {
    await knex.schema.alterTable('users', (table) => table.dropColumn('session_version'));
  }
};
