import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 4,
  name: '004_remove_main_worktrees',
  description: 'Remove main worktrees from database - Bob should not manage them',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Delete all Claude instances associated with main worktrees first
    // Main worktrees are identified by having the same path as their repository
    await run(`
      DELETE FROM claude_instances 
      WHERE worktree_id IN (
        SELECT w.id FROM worktrees w 
        JOIN repositories r ON w.repository_id = r.id 
        WHERE w.path = r.path
      )
    `);

    // Delete all main worktrees from the database
    // Main worktrees are identified by having the same path as their repository
    await run(`
      DELETE FROM worktrees 
      WHERE id IN (
        SELECT w.id FROM worktrees w 
        JOIN repositories r ON w.repository_id = r.id 
        WHERE w.path = r.path
      )
    `);

    console.log('Removed main worktrees from database - Bob should not manage them');
  },

  async down(db: any): Promise<void> {
    // No rollback for this migration - main worktrees should not be managed by Bob
    console.log('No rollback for removing main worktrees - they should not be managed by Bob');
  }
};

export default migration;