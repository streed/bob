#!/usr/bin/env node

import sqlite3 from 'sqlite3';
import { MigrationRunner } from '../database/migration-runner.js';

const command = process.argv[2];
const dbPath = process.argv[3] || 'bob.db';

async function main() {
  const db = new sqlite3.Database(dbPath);
  const migrationRunner = new MigrationRunner(db);

  try {
    await migrationRunner.init();
    switch (command) {
      case 'status':
        await showStatus(migrationRunner);
        break;
      case 'up':
        await runMigrations(migrationRunner);
        break;
      case 'down':
        await rollbackLastMigration(migrationRunner);
        break;
      case 'reset':
        await resetDatabase(migrationRunner);
        break;
      case 'create':
        await createMigration(process.argv[3]);
        break;
      default:
        showHelp();
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

async function showStatus(migrationRunner: MigrationRunner) {
  console.log('Migration Status:');
  console.log('================');
  
  const status = await migrationRunner.getStatus();
  
  console.log(`Applied migrations: ${status.applied.length}`);
  if (status.applied.length > 0) {
    status.applied.forEach(id => console.log(`  ✓ ${id}`));
  }
  
  console.log(`\\nPending migrations: ${status.pending.length}`);
  if (status.pending.length > 0) {
    status.pending.forEach(migration => 
      console.log(`  • ${migration.id}: ${migration.name} - ${migration.description}`)
    );
  } else {
    console.log('  (none)');
  }
  
  console.log(`\\nTotal available migrations: ${status.available.length}`);
}

async function runMigrations(migrationRunner: MigrationRunner) {
  console.log('Running pending migrations...');
  await migrationRunner.runPendingMigrations();
}

async function rollbackLastMigration(migrationRunner: MigrationRunner) {
  console.log('Rolling back last migration...');
  await migrationRunner.rollbackLastMigration();
}

async function resetDatabase(migrationRunner: MigrationRunner) {
  console.log('Resetting database (rolling back all migrations)...');
  const status = await migrationRunner.getStatus();
  
  if (status.applied.length === 0) {
    console.log('No migrations to rollback');
    return;
  }
  
  await migrationRunner.rollbackToMigration(0);
  console.log('Database reset completed');
}

async function createMigration(name: string) {
  if (!name) {
    console.error('Migration name is required');
    console.log('Usage: npm run migrate create <migration_name>');
    process.exit(1);
  }
  
  const { readdirSync, writeFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  const migrationsDir = join(__dirname, '../database/migrations');
  const existingMigrations = readdirSync(migrationsDir)
    .filter(file => file.match(/^\\d+_/))
    .map(file => parseInt(file.split('_')[0]))
    .sort((a, b) => a - b);
  
  const nextId = existingMigrations.length > 0 
    ? Math.max(...existingMigrations) + 1 
    : 2; // Start from 2 since 001 is the initial schema
  
  const migrationId = nextId.toString().padStart(3, '0');
  const fileName = `${migrationId}_${name.toLowerCase().replace(/\s+/g, '_')}.ts`;
  const filePath = join(migrationsDir, fileName);
  
  const template = `import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: ${nextId},
  name: '${migrationId}_${name.toLowerCase().replace(/\s+/g, '_')}',
  description: 'TODO: Add description for this migration',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));
    
    // TODO: Implement migration logic
    // Example:
    // await run('ALTER TABLE repositories ADD COLUMN new_field TEXT');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));
    
    // TODO: Implement rollback logic
    // Example:
    // await run('ALTER TABLE repositories DROP COLUMN new_field');
  }
};

export default migration;
`;
  
  writeFileSync(filePath, template);
  console.log(`Created migration: ${fileName}`);
  console.log(`Edit the file to implement your migration: ${filePath}`);
}

function showHelp() {
  console.log('Bob - Database Migration Tool');
  console.log('=============================');
  console.log('');
  console.log('Usage: npm run migrate <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  status                    Show migration status');
  console.log('  up                        Run all pending migrations');
  console.log('  down                      Rollback the last migration');
  console.log('  reset                     Rollback all migrations');
  console.log('  create <name>             Create a new migration file');
  console.log('');
  console.log('Options:');
  console.log('  [db_path]                 Database file path (default: claude-manager.db)');
  console.log('');
  console.log('Examples:');
  console.log('  npm run migrate status');
  console.log('  npm run migrate up');
  console.log('  npm run migrate down');
  console.log('  npm run migrate create "add user preferences"');
  console.log('  npm run migrate status /path/to/custom.db');
}

main();