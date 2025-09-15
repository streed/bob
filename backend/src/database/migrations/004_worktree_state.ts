import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 4,
  name: '004_worktree_state',
  description: 'Add state tracking to worktrees (working, review, done)',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Add state column to worktrees table
    await run(`
      ALTER TABLE worktrees 
      ADD COLUMN state TEXT NOT NULL DEFAULT 'working' 
      CHECK (state IN ('working', 'review', 'done'))
    `);

    // Add PR URL column to track pull request information
    await run(`
      ALTER TABLE worktrees 
      ADD COLUMN pr_url TEXT
    `);

    // Add merge status check timestamp
    await run(`
      ALTER TABLE worktrees 
      ADD COLUMN last_merge_check DATETIME
    `);

    // Create index for state-based queries
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_state ON worktrees(state)');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Drop the index
    await run('DROP INDEX IF EXISTS idx_worktrees_state');

    // Note: SQLite doesn't support dropping columns directly
    // In a real migration system, we would recreate the table without these columns
    // For this implementation, we'll leave the columns in place during downgrade
    console.warn('Downgrade note: state, pr_url, and last_merge_check columns will remain in worktrees table');
  }
};

export default migration;