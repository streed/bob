import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 5,
  name: '005_remove_main_worktrees',
  description: 'Remove main worktrees from database - Bob should not manage them',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Delete all Claude instances associated with main worktrees first
    await run(`
      DELETE FROM claude_instances 
      WHERE worktree_id IN (
        SELECT id FROM worktrees WHERE is_main_worktree = 1
      )
    `);

    // Delete all main worktrees from the database
    await run(`
      DELETE FROM worktrees 
      WHERE is_main_worktree = 1
    `);

    console.log('Removed main worktrees from database - Bob should not manage them');
  },

  async down(db: any): Promise<void> {
    // No rollback for this migration - main worktrees should not be managed by Bob
    console.log('No rollback for removing main worktrees - they should not be managed by Bob');
  }
};

export default migration;