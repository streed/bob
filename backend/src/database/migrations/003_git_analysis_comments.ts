import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 3,
  name: '003_git_analysis_comments',
  description: 'Create tables for git diff analysis and comments',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Create git_analysis table - stores analysis results for specific git states
    await run(`
      CREATE TABLE IF NOT EXISTS git_analysis (
        id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL,
        git_hash TEXT NOT NULL,
        analysis_summary TEXT,
        analysis_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
        UNIQUE(worktree_id, git_hash)
      )
    `);

    // Create diff_comments table - stores both AI and user comments on code
    await run(`
      CREATE TABLE IF NOT EXISTS diff_comments (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        comment_type TEXT NOT NULL CHECK (comment_type IN ('suggestion', 'warning', 'error', 'user')),
        message TEXT NOT NULL,
        severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
        is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
        user_reply TEXT,
        is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (analysis_id) REFERENCES git_analysis(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    await run('CREATE INDEX IF NOT EXISTS idx_git_analysis_worktree ON git_analysis(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_git_analysis_hash ON git_analysis(git_hash)');
    await run('CREATE INDEX IF NOT EXISTS idx_git_analysis_timestamp ON git_analysis(analysis_timestamp)');

    await run('CREATE INDEX IF NOT EXISTS idx_diff_comments_analysis ON diff_comments(analysis_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_diff_comments_worktree ON diff_comments(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_diff_comments_file ON diff_comments(file_path)');
    await run('CREATE INDEX IF NOT EXISTS idx_diff_comments_type ON diff_comments(comment_type)');
    await run('CREATE INDEX IF NOT EXISTS idx_diff_comments_dismissed ON diff_comments(is_dismissed)');

    // Create triggers to update updated_at timestamp
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_git_analysis_updated_at
        AFTER UPDATE ON git_analysis
      BEGIN
        UPDATE git_analysis SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_diff_comments_updated_at
        AFTER UPDATE ON diff_comments
      BEGIN
        UPDATE diff_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Drop triggers first
    await run('DROP TRIGGER IF EXISTS update_git_analysis_updated_at');
    await run('DROP TRIGGER IF EXISTS update_diff_comments_updated_at');

    // Drop indexes
    await run('DROP INDEX IF EXISTS idx_git_analysis_worktree');
    await run('DROP INDEX IF EXISTS idx_git_analysis_hash');
    await run('DROP INDEX IF EXISTS idx_git_analysis_timestamp');
    await run('DROP INDEX IF EXISTS idx_diff_comments_analysis');
    await run('DROP INDEX IF EXISTS idx_diff_comments_worktree');
    await run('DROP INDEX IF EXISTS idx_diff_comments_file');
    await run('DROP INDEX IF EXISTS idx_diff_comments_type');
    await run('DROP INDEX IF EXISTS idx_diff_comments_dismissed');

    // Drop tables
    await run('DROP TABLE IF EXISTS diff_comments');
    await run('DROP TABLE IF EXISTS git_analysis');
  }
};

export default migration;