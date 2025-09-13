import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Migration } from './migrations/migration-interface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MigrationRunner {
  private db: sqlite3.Database;
  private dbRun: (sql: string, params?: any[]) => Promise<any>;
  private dbGet: (sql: string, params?: any[]) => Promise<any>;
  private dbAll: (sql: string, params?: any[]) => Promise<any[]>;

  constructor(db: sqlite3.Database) {
    this.db = db;
    this.dbRun = promisify(db.run.bind(db));
    this.dbGet = promisify(db.get.bind(db));
    this.dbAll = promisify(db.all.bind(db));
  }

  async init(): Promise<void> {
    await this.initializeMigrationsTable();
  }

  private async initializeMigrationsTable(): Promise<void> {
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(id)
      )
    `);
  }

  async getAppliedMigrations(): Promise<number[]> {
    const rows = await this.dbAll('SELECT id FROM migrations ORDER BY id ASC');
    return rows.map(row => row.id);
  }

  async getAvailableMigrations(): Promise<Migration[]> {
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter(file => (file.endsWith('.js') || file.endsWith('.ts')) && !file.includes('migration-interface'))
      .sort();

    const migrations: Migration[] = [];
    
    for (const file of migrationFiles) {
      try {
        const migrationPath = join(migrationsDir, file);
        const migrationModule = await import(migrationPath);
        const migration = migrationModule.default || migrationModule;
        
        if (migration && typeof migration.up === 'function' && typeof migration.down === 'function') {
          migrations.push(migration);
        } else {
          console.warn(`Invalid migration file: ${file}`);
        }
      } catch (error) {
        console.error(`Failed to load migration ${file}:`, error);
      }
    }

    return migrations.sort((a, b) => a.id - b.id);
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const applied = await this.getAppliedMigrations();
    const available = await this.getAvailableMigrations();
    
    return available.filter(migration => !applied.includes(migration.id));
  }

  async runMigration(migration: Migration): Promise<void> {
    console.log(`Running migration ${migration.id}: ${migration.name}`);
    
    try {
      // Begin transaction
      await this.dbRun('BEGIN TRANSACTION');
      
      // Run the migration
      await migration.up(this.db);
      
      // Record the migration as applied
      await this.dbRun(
        'INSERT INTO migrations (id, name, description) VALUES (?, ?, ?)',
        [migration.id, migration.name, migration.description]
      );
      
      // Commit transaction
      await this.dbRun('COMMIT');
      
      console.log(`✓ Migration ${migration.id} completed successfully`);
    } catch (error) {
      // Rollback transaction
      await this.dbRun('ROLLBACK');
      console.error(`✗ Migration ${migration.id} failed:`, error);
      throw error;
    }
  }

  async rollbackMigration(migration: Migration): Promise<void> {
    console.log(`Rolling back migration ${migration.id}: ${migration.name}`);
    
    try {
      // Begin transaction
      await this.dbRun('BEGIN TRANSACTION');
      
      // Run the rollback
      await migration.down(this.db);
      
      // Remove the migration from applied list
      await this.dbRun('DELETE FROM migrations WHERE id = ?', [migration.id]);
      
      // Commit transaction
      await this.dbRun('COMMIT');
      
      console.log(`✓ Migration ${migration.id} rolled back successfully`);
    } catch (error) {
      // Rollback transaction
      await this.dbRun('ROLLBACK');
      console.error(`✗ Rollback of migration ${migration.id} failed:`, error);
      throw error;
    }
  }

  async runPendingMigrations(): Promise<void> {
    const pending = await this.getPendingMigrations();
    
    if (pending.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Running ${pending.length} pending migration(s)...`);
    
    for (const migration of pending) {
      await this.runMigration(migration);
    }
    
    console.log('All pending migrations completed');
  }

  async rollbackLastMigration(): Promise<void> {
    const applied = await this.getAppliedMigrations();
    const available = await this.getAvailableMigrations();
    
    if (applied.length === 0) {
      console.log('No migrations to rollback');
      return;
    }

    const lastAppliedId = applied[applied.length - 1];
    const migration = available.find(m => m.id === lastAppliedId);
    
    if (!migration) {
      throw new Error(`Migration ${lastAppliedId} not found in available migrations`);
    }

    await this.rollbackMigration(migration);
  }

  async rollbackToMigration(targetId: number): Promise<void> {
    const applied = await this.getAppliedMigrations();
    const available = await this.getAvailableMigrations();
    
    const migrationsToRollback = applied
      .filter(id => id > targetId)
      .sort((a, b) => b - a); // Rollback in reverse order

    if (migrationsToRollback.length === 0) {
      console.log(`Already at or before migration ${targetId}`);
      return;
    }

    console.log(`Rolling back ${migrationsToRollback.length} migration(s) to reach migration ${targetId}`);
    
    for (const migrationId of migrationsToRollback) {
      const migration = available.find(m => m.id === migrationId);
      if (migration) {
        await this.rollbackMigration(migration);
      }
    }
    
    console.log(`Rollback to migration ${targetId} completed`);
  }

  async getStatus(): Promise<{applied: number[], available: Migration[], pending: Migration[]}> {
    const applied = await this.getAppliedMigrations();
    const available = await this.getAvailableMigrations();
    const pending = await this.getPendingMigrations();
    
    return { applied, available, pending };
  }
}