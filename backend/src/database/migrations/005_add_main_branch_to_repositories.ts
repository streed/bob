import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 5,
  name: '005_add_main_branch_to_repositories',
  description: 'Add main_branch column to repositories table to track the default branch',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Add main_branch column to repositories table
    await run(`
      ALTER TABLE repositories 
      ADD COLUMN main_branch TEXT
    `);

    console.log('Added main_branch column to repositories table');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Note: SQLite doesn't support DROP COLUMN, so we would need to recreate the table
    // For simplicity, we'll leave the column but it won't be used
    console.log('main_branch column left in place (SQLite does not support DROP COLUMN)');
  }
};

export default migration;