import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { Repository, Worktree, ClaudeInstance } from '../types.js';
import { MigrationRunner } from './migration-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DatabaseService {
  private db: sqlite3.Database;
  private migrationRunner: MigrationRunner;
  private run: (sql: string, params?: any[]) => Promise<sqlite3.RunResult>;
  private get: (sql: string, params?: any[]) => Promise<any>;
  private all: (sql: string, params?: any[]) => Promise<any[]>;

  constructor(dbPath: string = 'bob.db') {
    this.db = new sqlite3.Database(dbPath);
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
    this.migrationRunner = new MigrationRunner(this.db);
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      console.log('Initializing database...');
      await this.migrationRunner.init();
      console.log('Running database migrations...');
      await this.migrationRunner.runPendingMigrations();
      console.log('Database ready');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  getMigrationRunner(): MigrationRunner {
    return this.migrationRunner;
  }

  // Repository methods
  async saveRepository(repo: Repository): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO repositories (id, name, path, branch) VALUES (?, ?, ?, ?)`,
      [repo.id, repo.name, repo.path, repo.branch]
    );
  }

  async getRepository(id: string): Promise<Repository | null> {
    const row = await this.get('SELECT * FROM repositories WHERE id = ?', [id]);
    
    if (!row) return null;

    const worktrees = await this.getWorktreesByRepository(id);
    
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      branch: row.branch,
      worktrees
    };
  }

  async getAllRepositories(): Promise<Repository[]> {
    const rows = await this.all('SELECT * FROM repositories ORDER BY created_at DESC');
    
    const repositories = await Promise.all(rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      branch: row.branch,
      worktrees: await this.getWorktreesByRepository(row.id)
    })));

    return repositories;
  }

  async deleteRepository(id: string): Promise<void> {
    await this.run('DELETE FROM repositories WHERE id = ?', [id]);
  }

  // Worktree methods
  async saveWorktree(worktree: Worktree): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO worktrees (id, repository_id, path, branch) VALUES (?, ?, ?, ?)`,
      [worktree.id, worktree.repositoryId, worktree.path, worktree.branch]
    );
  }

  async getWorktree(id: string): Promise<Worktree | null> {
    const row = await this.get('SELECT * FROM worktrees WHERE id = ?', [id]);
    
    if (!row) return null;

    const instances = await this.getInstancesByWorktree(id);

    return {
      id: row.id,
      repositoryId: row.repository_id,
      path: row.path,
      branch: row.branch,
      instances
    };
  }

  async getWorktreesByRepository(repositoryId: string): Promise<Worktree[]> {
    const rows = await this.all('SELECT * FROM worktrees WHERE repository_id = ? ORDER BY created_at DESC', [repositoryId]);
    
    const worktrees = await Promise.all(rows.map(async (row) => ({
      id: row.id,
      repositoryId: row.repository_id,
      path: row.path,
      branch: row.branch,
      instances: await this.getInstancesByWorktree(row.id)
    })));

    return worktrees;
  }

  async deleteWorktree(id: string): Promise<void> {
    await this.run('DELETE FROM worktrees WHERE id = ?', [id]);
  }

  // Claude instance methods
  async saveInstance(instance: ClaudeInstance): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO claude_instances 
       (id, repository_id, worktree_id, status, pid, port, last_activity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        instance.id,
        instance.repositoryId,
        instance.worktreeId,
        instance.status,
        instance.pid || null,
        instance.port || null,
        instance.lastActivity ? new Date(instance.lastActivity).toISOString() : null
      ]
    );
  }

  async getInstance(id: string): Promise<ClaudeInstance | null> {
    const row = await this.get('SELECT * FROM claude_instances WHERE id = ?', [id]);
    
    if (!row) return null;

    return {
      id: row.id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined
    };
  }

  async getAllInstances(): Promise<ClaudeInstance[]> {
    const rows = await this.all('SELECT * FROM claude_instances ORDER BY created_at DESC');
    
    return rows.map(row => ({
      id: row.id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined
    }));
  }

  async getInstancesByRepository(repositoryId: string): Promise<ClaudeInstance[]> {
    const rows = await this.all('SELECT * FROM claude_instances WHERE repository_id = ? ORDER BY created_at DESC', [repositoryId]);
    
    return rows.map(row => ({
      id: row.id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined
    }));
  }

  async getInstancesByWorktree(worktreeId: string): Promise<ClaudeInstance[]> {
    const rows = await this.all('SELECT * FROM claude_instances WHERE worktree_id = ? ORDER BY created_at DESC', [worktreeId]);
    
    return rows.map(row => ({
      id: row.id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined
    }));
  }

  async deleteInstance(id: string): Promise<void> {
    await this.run('DELETE FROM claude_instances WHERE id = ?', [id]);
  }

  async updateInstanceStatus(id: string, status: ClaudeInstance['status'], pid?: number): Promise<void> {
    await this.run(
      `UPDATE claude_instances 
       SET status = ?, pid = ?, last_activity = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [status, pid || null, id]
    );
  }

  async updateInstanceActivity(id: string): Promise<void> {
    await this.run(
      `UPDATE claude_instances 
       SET last_activity = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [id]
    );
  }

  // Cleanup methods
  async cleanupStoppedInstances(): Promise<void> {
    await this.run(
      `DELETE FROM claude_instances 
       WHERE status IN ('stopped', 'error') 
       AND datetime(updated_at) < datetime('now', '-1 hour')`
    );
  }

  close(): void {
    this.db.close();
  }
}