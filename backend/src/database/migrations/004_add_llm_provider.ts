import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 4,
  name: '004_add_llm_provider',
  description: 'Add provider field to claude_instances table to support multiple LLM providers',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Add provider column to claude_instances table
    await run(`
      ALTER TABLE claude_instances 
      ADD COLUMN provider TEXT DEFAULT 'claude' 
      CHECK (provider IN ('claude', 'codex'))
    `);

    // Update any existing instances to use claude as the default provider
    await run(`
      UPDATE claude_instances 
      SET provider = 'claude' 
      WHERE provider IS NULL
    `);

    // Create index for provider filtering
    await run('CREATE INDEX IF NOT EXISTS idx_instances_provider ON claude_instances(provider)');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Drop index
    await run('DROP INDEX IF EXISTS idx_instances_provider');

    // Remove provider column
    // Note: SQLite doesn't support DROP COLUMN directly, so we'd need to recreate the table
    // For simplicity, we'll keep this as a no-op since it's backwards compatible
    console.log('Migration down: provider column preserved for backwards compatibility');
  }
};

export default migration;