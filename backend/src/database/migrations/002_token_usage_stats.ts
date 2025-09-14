import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 2,
  name: '002_token_usage_stats',
  description: 'Create token usage statistics tables for tracking Claude instance usage',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Create token_usage_sessions table - tracks individual usage sessions
    await run(`
      CREATE TABLE IF NOT EXISTS token_usage_sessions (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd DECIMAL(10,4) DEFAULT 0,
        session_start DATETIME NOT NULL,
        session_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (instance_id) REFERENCES claude_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    // Create daily_usage_stats table - aggregated daily statistics
    await run(`
      CREATE TABLE IF NOT EXISTS daily_usage_stats (
        date TEXT PRIMARY KEY,
        total_input_tokens INTEGER NOT NULL DEFAULT 0,
        total_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd DECIMAL(10,4) DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        active_instances INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create instance_usage_summary table - per-instance usage summaries
    await run(`
      CREATE TABLE IF NOT EXISTS instance_usage_summary (
        instance_id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        total_input_tokens INTEGER NOT NULL DEFAULT 0,
        total_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd DECIMAL(10,4) DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        first_usage DATETIME,
        last_usage DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (instance_id) REFERENCES claude_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    await run('CREATE INDEX IF NOT EXISTS idx_token_sessions_instance_id ON token_usage_sessions(instance_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_token_sessions_worktree_id ON token_usage_sessions(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_token_sessions_date ON token_usage_sessions(date(session_start))');
    await run('CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage_stats(date)');
    await run('CREATE INDEX IF NOT EXISTS idx_instance_summary_worktree ON instance_usage_summary(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instance_summary_last_usage ON instance_usage_summary(last_usage)');

    // Create triggers to update updated_at timestamp
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_token_sessions_updated_at
        AFTER UPDATE ON token_usage_sessions
      BEGIN
        UPDATE token_usage_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_daily_stats_updated_at
        AFTER UPDATE ON daily_usage_stats
      BEGIN
        UPDATE daily_usage_stats SET updated_at = CURRENT_TIMESTAMP WHERE date = NEW.date;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_instance_summary_updated_at
        AFTER UPDATE ON instance_usage_summary
      BEGIN
        UPDATE instance_usage_summary SET updated_at = CURRENT_TIMESTAMP WHERE instance_id = NEW.instance_id;
      END
    `);
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Drop triggers first
    await run('DROP TRIGGER IF EXISTS update_token_sessions_updated_at');
    await run('DROP TRIGGER IF EXISTS update_daily_stats_updated_at');
    await run('DROP TRIGGER IF EXISTS update_instance_summary_updated_at');

    // Drop indexes
    await run('DROP INDEX IF EXISTS idx_token_sessions_instance_id');
    await run('DROP INDEX IF EXISTS idx_token_sessions_worktree_id');
    await run('DROP INDEX IF EXISTS idx_token_sessions_date');
    await run('DROP INDEX IF EXISTS idx_daily_usage_date');
    await run('DROP INDEX IF EXISTS idx_instance_summary_worktree');
    await run('DROP INDEX IF EXISTS idx_instance_summary_last_usage');

    // Drop tables
    await run('DROP TABLE IF EXISTS token_usage_sessions');
    await run('DROP TABLE IF EXISTS daily_usage_stats');
    await run('DROP TABLE IF EXISTS instance_usage_summary');
  }
};

export default migration;