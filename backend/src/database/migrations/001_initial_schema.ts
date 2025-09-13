import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 1,
  name: '001_initial_schema',
  description: 'Create initial Bob database schema with repositories, worktrees, and claude_instances tables',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Create repositories table
    await run(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create worktrees table
    await run(`
      CREATE TABLE IF NOT EXISTS worktrees (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    // Create claude instances table
    await run(`
      CREATE TABLE IF NOT EXISTS claude_instances (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'error')),
        pid INTEGER,
        port INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_repository_id ON worktrees(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instances_repository_id ON claude_instances(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instances_worktree_id ON claude_instances(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instances_status ON claude_instances(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_repositories_path ON repositories(path)');
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(path)');

    // Create triggers to update updated_at timestamp
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_repositories_updated_at 
        AFTER UPDATE ON repositories
      BEGIN
        UPDATE repositories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_worktrees_updated_at 
        AFTER UPDATE ON worktrees
      BEGIN
        UPDATE worktrees SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_instances_updated_at 
        AFTER UPDATE ON claude_instances
      BEGIN
        UPDATE claude_instances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Drop triggers first
    await run('DROP TRIGGER IF EXISTS update_repositories_updated_at');
    await run('DROP TRIGGER IF EXISTS update_worktrees_updated_at');
    await run('DROP TRIGGER IF EXISTS update_instances_updated_at');

    // Drop indexes
    await run('DROP INDEX IF EXISTS idx_worktrees_repository_id');
    await run('DROP INDEX IF EXISTS idx_instances_repository_id');
    await run('DROP INDEX IF EXISTS idx_instances_worktree_id');
    await run('DROP INDEX IF EXISTS idx_instances_status');
    await run('DROP INDEX IF EXISTS idx_repositories_path');
    await run('DROP INDEX IF EXISTS idx_worktrees_path');

    // Drop tables (in reverse order due to foreign keys)
    await run('DROP TABLE IF EXISTS claude_instances');
    await run('DROP TABLE IF EXISTS worktrees');
    await run('DROP TABLE IF EXISTS repositories');
  }
};

export default migration;