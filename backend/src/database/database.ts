import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { mkdirSync, existsSync } from 'fs';
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
  private initializationPromise: Promise<void>;

  constructor(dbPath?: string) {
    // Use DB_PATH environment variable if available, otherwise fallback to parameter or default
    const actualDbPath = dbPath || process.env.DB_PATH || 'bob.db';
    
    // Ensure the directory exists
    const dbDir = dirname(actualDbPath);
    if (!existsSync(dbDir)) {
      console.log(`Creating database directory: ${dbDir}`);
      mkdirSync(dbDir, { recursive: true });
    }
    
    console.log(`Initializing database at: ${actualDbPath}`);
    this.db = new sqlite3.Database(actualDbPath);
    
    // Custom promisify for run method to properly handle the callback signature
    this.run = (sql: string, params?: any[]) => {
      return new Promise<sqlite3.RunResult>((resolve, reject) => {
        this.db.run(sql, params || [], function(this: sqlite3.RunResult, err: Error | null) {
          if (err) {
            reject(err);
          } else {
            resolve(this);
          }
        });
      });
    };
    
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
    this.migrationRunner = new MigrationRunner(this.db);
    
    // Start initialization but don't block constructor
    this.initializationPromise = this.initialize();
  }

  async waitForInitialization(): Promise<void> {
    return this.initializationPromise;
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
      `INSERT OR REPLACE INTO repositories (id, name, path, branch, main_branch) VALUES (?, ?, ?, ?, ?)`,
      [repo.id, repo.name, repo.path, repo.branch, repo.mainBranch]
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
      mainBranch: row.main_branch || row.branch, // Fallback to current branch if main_branch is null
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
      mainBranch: row.main_branch || row.branch, // Fallback to current branch if main_branch is null
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
      instances,
      isMainWorktree: false // All worktrees in the database are non-main worktrees
    };
  }

  async getWorktreesByRepository(repositoryId: string): Promise<Worktree[]> {
    const rows = await this.all('SELECT * FROM worktrees WHERE repository_id = ? ORDER BY created_at DESC', [repositoryId]);
    
    const worktrees = await Promise.all(rows.map(async (row) => ({
      id: row.id,
      repositoryId: row.repository_id,
      path: row.path,
      branch: row.branch,
      instances: await this.getInstancesByWorktree(row.id),
      isMainWorktree: false // All worktrees in the database are non-main worktrees
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

  // Token Usage Statistics methods
  async saveTokenUsageSession(sessionData: {
    id: string;
    instanceId: string;
    worktreeId: string;
    repositoryId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    totalCostUsd?: number;
    sessionStart: Date;
    sessionEnd?: Date;
  }): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO token_usage_sessions
       (id, instance_id, worktree_id, repository_id, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, total_cost_usd, session_start, session_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionData.id,
        sessionData.instanceId,
        sessionData.worktreeId,
        sessionData.repositoryId,
        sessionData.inputTokens,
        sessionData.outputTokens,
        sessionData.cacheReadTokens || 0,
        sessionData.cacheCreationTokens || 0,
        sessionData.totalCostUsd || 0,
        sessionData.sessionStart.toISOString(),
        sessionData.sessionEnd ? sessionData.sessionEnd.toISOString() : null
      ]
    );
  }

  async updateInstanceUsageSummary(instanceId: string, usage: {
    worktreeId: string;
    repositoryId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    totalCostUsd?: number;
  }): Promise<void> {
    // Get current summary or create new one
    const current = await this.get(
      'SELECT * FROM instance_usage_summary WHERE instance_id = ?',
      [instanceId]
    );

    if (current) {
      // Update existing summary
      await this.run(
        `UPDATE instance_usage_summary
         SET total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             total_cache_read_tokens = total_cache_read_tokens + ?,
             total_cache_creation_tokens = total_cache_creation_tokens + ?,
             total_cost_usd = total_cost_usd + ?,
             session_count = session_count + 1,
             last_usage = CURRENT_TIMESTAMP
         WHERE instance_id = ?`,
        [
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0,
          instanceId
        ]
      );
    } else {
      // Create new summary
      await this.run(
        `INSERT INTO instance_usage_summary
         (instance_id, worktree_id, repository_id, total_input_tokens, total_output_tokens,
          total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd,
          session_count, first_usage, last_usage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          instanceId,
          usage.worktreeId,
          usage.repositoryId,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0
        ]
      );
    }
  }

  async updateDailyUsageStats(date: string, usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    totalCostUsd?: number;
  }): Promise<void> {
    const existing = await this.get(
      'SELECT * FROM daily_usage_stats WHERE date = ?',
      [date]
    );

    if (existing) {
      // Update existing daily stats
      await this.run(
        `UPDATE daily_usage_stats
         SET total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             total_cache_read_tokens = total_cache_read_tokens + ?,
             total_cache_creation_tokens = total_cache_creation_tokens + ?,
             total_cost_usd = total_cost_usd + ?
         WHERE date = ?`,
        [
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0,
          date
        ]
      );
    } else {
      // Create new daily stats
      await this.run(
        `INSERT INTO daily_usage_stats
         (date, total_input_tokens, total_output_tokens, total_cache_read_tokens,
          total_cache_creation_tokens, total_cost_usd, session_count, active_instances)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          date,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0
        ]
      );
    }
  }

  async getDailyUsageStats(days: number = 7): Promise<any[]> {
    return await this.all(
      `SELECT * FROM daily_usage_stats
       WHERE date >= date('now', '-' || ? || ' days')
       ORDER BY date ASC`,
      [days]
    );
  }

  async getInstanceUsageSummary(instanceId?: string): Promise<any[]> {
    if (instanceId) {
      const result = await this.get(
        'SELECT * FROM instance_usage_summary WHERE instance_id = ?',
        [instanceId]
      );
      return result ? [result] : [];
    }

    return await this.all(
      `SELECT ius.*, ci.status, ci.last_activity
       FROM instance_usage_summary ius
       LEFT JOIN claude_instances ci ON ius.instance_id = ci.id
       ORDER BY ius.last_usage DESC`
    );
  }

  async getTotalUsageStats(): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalSessions: number;
    totalCost: number;
  }> {
    const result = await this.get(
      `SELECT
         COALESCE(SUM(total_input_tokens + total_cache_read_tokens + total_cache_creation_tokens), 0) as totalInputTokens,
         COALESCE(SUM(total_output_tokens), 0) as totalOutputTokens,
         COALESCE(SUM(session_count), 0) as totalSessions,
         COALESCE(SUM(total_cost_usd), 0) as totalCost
       FROM instance_usage_summary`
    );

    return {
      totalInputTokens: result?.totalInputTokens || 0,
      totalOutputTokens: result?.totalOutputTokens || 0,
      totalSessions: result?.totalSessions || 0,
      totalCost: result?.totalCost || 0
    };
  }

  async cleanupOldTokenUsage(daysToKeep: number = 30): Promise<void> {
    // Clean up old session data but keep daily aggregates
    await this.run(
      `DELETE FROM token_usage_sessions
       WHERE session_start < date('now', '-' || ? || ' days')`,
      [daysToKeep]
    );
  }

  // Database administration methods
  async getAllTables(): Promise<string[]> {
    const result = await this.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    return result.map(row => row.name);
  }

  async getTableSchema(tableName: string): Promise<any[]> {
    return await this.all(`PRAGMA table_info(${tableName})`);
  }

  async getTableData(tableName: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    return await this.all(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`, [limit, offset]);
  }

  async getTableCount(tableName: string): Promise<number> {
    const result = await this.get(`SELECT COUNT(*) as count FROM ${tableName}`);
    return result.count;
  }

  async executeQuery(sql: string): Promise<any[]> {
    return await this.all(sql);
  }

  async deleteRows(tableName: string, whereClause: string): Promise<number> {
    const result = await this.run(`DELETE FROM ${tableName} WHERE ${whereClause}`);
    return result.changes || 0;
  }

  async updateRows(tableName: string, setClause: string, whereClause: string): Promise<number> {
    const result = await this.run(`UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`);
    return result.changes || 0;
  }

  close(): void {
    this.db.close();
  }
}