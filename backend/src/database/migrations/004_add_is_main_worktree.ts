import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 4,
  name: '004_add_is_main_worktree',
  description: 'Add is_main_worktree column to worktrees table to identify main working trees',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Add is_main_worktree column to worktrees table
    await run(`
      ALTER TABLE worktrees 
      ADD COLUMN is_main_worktree BOOLEAN DEFAULT 0 NOT NULL
    `);

    // Update existing records - mark the first worktree for each repository as main
    await run(`
      UPDATE worktrees 
      SET is_main_worktree = 1 
      WHERE id IN (
        SELECT w1.id 
        FROM worktrees w1
        LEFT JOIN worktrees w2 ON w1.repository_id = w2.repository_id AND w1.created_at > w2.created_at
        WHERE w2.id IS NULL
      )
    `);
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // SQLite doesn't support DROP COLUMN, so we need to recreate the table
    await run(`
      CREATE TABLE worktrees_backup AS 
      SELECT id, repository_id, path, branch, created_at, updated_at 
      FROM worktrees
    `);

    await run('DROP TABLE worktrees');

    await run(`
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    await run(`
      INSERT INTO worktrees (id, repository_id, path, branch, created_at, updated_at)
      SELECT id, repository_id, path, branch, created_at, updated_at
      FROM worktrees_backup
    `);

    await run('DROP TABLE worktrees_backup');

    // Recreate indexes
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_repository_id ON worktrees(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(path)');

    // Recreate trigger
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_worktrees_updated_at 
        AFTER UPDATE ON worktrees
      BEGIN
        UPDATE worktrees SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);
  }
};

export default migration;