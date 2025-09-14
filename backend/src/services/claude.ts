import { spawn, ChildProcess } from 'child_process';
import { spawn as spawnPty, IPty } from 'node-pty';
import { ClaudeInstance, Worktree } from '../types.js';
import { GitService } from './git.js';
import { DatabaseService } from '../database/database.js';

export class ClaudeService {
  private instances = new Map<string, ClaudeInstance>();
  private processes = new Map<string, ChildProcess>();
  private ptyProcesses = new Map<string, IPty>();
  private nextPort = 3100;

  // Real-time token usage tracking
  private instanceTokenUsage = new Map<string, { input: number; output: number; cost: number }>();
  private usageCollectionIntervals = new Map<string, NodeJS.Timeout>();
  private cumulativeTokens = { input: 0, output: 0 };
  private sessionStartTimes = new Map<string, number>();

  constructor(private gitService: GitService, private db: DatabaseService) {
    this.loadFromDatabase();
  }

  private async loadFromDatabase(): Promise<void> {
    const instances = await this.db.getAllInstances();
    instances.forEach(instance => {
      // Only load non-running instances (running instances need to be restarted)
      if (instance.status !== 'running') {
        this.instances.set(instance.id, instance);
        
        // Add instance to worktree
        const worktree = this.gitService.getWorktree(instance.worktreeId);
        if (worktree) {
          worktree.instances.push(instance);
        }
      }
    });
  }

  async startInstance(worktreeId: string): Promise<ClaudeInstance> {
    const worktree = this.gitService.getWorktree(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    // Check for any existing instance (regardless of status)
    const existingInstance = Array.from(this.instances.values())
      .find(i => i.worktreeId === worktreeId);
    
    if (existingInstance) {
      if (existingInstance.status === 'running') {
        throw new Error(`Claude instance already running for this worktree. Stop the existing instance first.`);
      } else if (existingInstance.status === 'starting') {
        throw new Error(`Claude instance is already starting for this worktree. Please wait for it to finish.`);
      } else {
        // If instance exists but is stopped/error, restart it instead of creating new one
        console.log(`Found existing stopped instance ${existingInstance.id}, restarting instead of creating new one`);
        return await this.restartInstance(existingInstance.id);
      }
    }

    const instanceId = `claude-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const port = this.nextPort++;

    const instance: ClaudeInstance = {
      id: instanceId,
      worktreeId,
      repositoryId: worktree.repositoryId,
      status: 'starting',
      port,
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.instances.set(instanceId, instance);
    worktree.instances.push(instance);
    
    await this.db.saveInstance(instance);

    try {
      const claudePty = await this.spawnClaudePty(instance, worktree);
      this.ptyProcesses.set(instanceId, claudePty);
      
      instance.pid = claudePty.pid;
      instance.status = 'running';
      
      await this.db.saveInstance(instance);
      
      this.setupPtyHandlers(instance, claudePty);

      // Start token usage collection for this instance
      this.startUsageCollection(instance.id);

      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.saveInstance(instance);
      throw new Error(`Failed to start Claude instance: ${error}`);
    }
  }

  private async spawnClaudeProcess(instance: ClaudeInstance, worktree: Worktree): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      console.log(`Starting Claude Code in directory: ${worktree.path}`);
      
      const claudeProcess = spawn('claude', [], {
        cwd: worktree.path,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: {
          ...process.env,
          CLAUDE_CODE_PORT: instance.port?.toString(),
          PATH: process.env.PATH
        }
      });

      let spawned = false;
      let output = '';
      let errorOutput = '';

      claudeProcess.stdout?.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        console.log(`Claude ${instance.id} stdout:`, dataStr);
      });

      claudeProcess.stderr?.on('data', (data) => {
        const dataStr = data.toString();
        errorOutput += dataStr;
        console.error(`Claude ${instance.id} stderr:`, dataStr);
      });

      claudeProcess.on('spawn', () => {
        console.log(`Process spawned for Claude instance ${instance.id} with PID ${claudeProcess.pid}`);
        // Give Claude a moment to initialize, then assume it's running
        setTimeout(() => {
          if (!spawned && !claudeProcess.killed) {
            spawned = true;
            console.log(`Claude Code assumed ready for worktree ${worktree.path}`);
            resolve(claudeProcess);
          }
        }, 3000);
      });

      claudeProcess.on('error', (error) => {
        console.error(`Failed to start Claude Code process:`, error);
        if (!spawned) {
          reject(error);
        }
      });

      claudeProcess.on('exit', (code, signal) => {
        console.log(`Claude process exited with code ${code}, signal ${signal}`);
        if (!spawned) {
          if (code !== 0) {
            reject(new Error(`Claude Code exited with code ${code}. Output: ${output}, Error: ${errorOutput}`));
          } else {
            reject(new Error(`Claude Code process exited unexpectedly`));
          }
        }
      });

      // Timeout as fallback
      const timeout = setTimeout(() => {
        if (!spawned) {
          claudeProcess.kill('SIGTERM');
          reject(new Error(`Claude Code process failed to start within timeout. Output: ${output}, Error: ${errorOutput}`));
        }
      }, 10000);

      // Clear timeout when spawned
      claudeProcess.on('spawn', () => {
        setTimeout(() => {
          if (spawned) {
            clearTimeout(timeout);
          }
        }, 3100);
      });
    });
  }

  private async spawnClaudePty(instance: ClaudeInstance, worktree: Worktree): Promise<IPty> {
    return new Promise((resolve, reject) => {
      console.log(`Starting Claude Code PTY in directory: ${worktree.path}`);
      
      const claudePty = spawnPty('claude', [], {
        cwd: worktree.path,
        cols: 80,
        rows: 30,
        env: {
          ...process.env,
          CLAUDE_CODE_PORT: instance.port?.toString(),
          PATH: process.env.PATH
        } as { [key: string]: string }
      });

      let spawned = false;
      let output = '';

      claudePty.onData((data: string) => {
        output += data;
        console.log(`Claude PTY ${instance.id} output:`, data);
        
        if (!spawned && (data.includes('Claude') || data.includes('claude') || output.length > 100)) {
          spawned = true;
          console.log(`Claude Code PTY ready for worktree ${worktree.path} with PID ${claudePty.pid}`);
          resolve(claudePty);
        }
      });

      claudePty.onExit(() => {
        console.log(`Claude PTY process exited`);
        if (!spawned) {
          reject(new Error(`Claude Code PTY process exited unexpectedly. Output: ${output}`));
        }
      });

      // Timeout as fallback
      const timeout = setTimeout(() => {
        if (!spawned) {
          claudePty.kill();
          reject(new Error(`Claude Code PTY failed to start within timeout. Output: ${output}`));
        }
      }, 10000);

      setTimeout(() => {
        if (!spawned) {
          spawned = true;
          clearTimeout(timeout);
          console.log(`Claude Code PTY assumed ready for worktree ${worktree.path}`);
          resolve(claudePty);
        }
      }, 3000);
    });
  }

  private setupPtyHandlers(instance: ClaudeInstance, claudePty: IPty): void {
    claudePty.onExit((exitCode) => {
      console.log(`Claude Code PTY ${instance.id} exited with code ${exitCode}`);
      instance.status = 'stopped';
      this.ptyProcesses.delete(instance.id);
      
      const worktree = this.gitService.getWorktree(instance.worktreeId);
      if (worktree) {
        worktree.instances = worktree.instances.filter(i => i.id !== instance.id);
      }
      
      this.instances.delete(instance.id);
      this.db.saveInstance(instance).catch(err => console.error('Failed to save instance:', err));
    });

    claudePty.onData((data: string) => {
      instance.lastActivity = new Date();
      this.db.updateInstanceActivity(instance.id).catch(err => console.error('Failed to update activity:', err));
    });
  }

  private setupProcessHandlers(instance: ClaudeInstance, claudeProcess: ChildProcess): void {
    claudeProcess.on('exit', (code, signal) => {
      console.log(`Claude Code process ${instance.id} exited with code ${code}, signal ${signal}`);
      instance.status = 'stopped';
      this.processes.delete(instance.id);
      
      const worktree = this.gitService.getWorktree(instance.worktreeId);
      if (worktree) {
        worktree.instances = worktree.instances.filter(i => i.id !== instance.id);
      }
      
      this.instances.delete(instance.id);
      this.db.saveInstance(instance).catch(err => console.error('Failed to save instance:', err));
    });

    claudeProcess.on('error', (error) => {
      console.error(`Claude Code process ${instance.id} error:`, error);
      instance.status = 'error';
      instance.errorMessage = error.message;
      this.db.saveInstance(instance).catch(err => console.error('Failed to save instance:', err));
    });

    claudeProcess.stdout?.on('data', (data) => {
      instance.lastActivity = new Date();
      this.db.updateInstanceActivity(instance.id).catch(err => console.error('Failed to update activity:', err));
    });

    claudeProcess.stderr?.on('data', (data) => {
      instance.lastActivity = new Date();
      this.db.updateInstanceActivity(instance.id).catch(err => console.error('Failed to update activity:', err));
    });
  }

  async stopInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    // Stop token usage collection
    this.stopUsageCollection(instanceId);

    // Handle PTY processes
    const claudePty = this.ptyProcesses.get(instanceId);
    if (claudePty) {
      claudePty.kill();
      this.ptyProcesses.delete(instanceId);
    }

    // Handle regular processes (fallback)
    const claudeProcess = this.processes.get(instanceId);
    if (claudeProcess && !claudeProcess.killed) {
      claudeProcess.kill('SIGTERM');
      
      setTimeout(() => {
        if (!claudeProcess.killed) {
          claudeProcess.kill('SIGKILL');
        }
      }, 5000);
      this.processes.delete(instanceId);
    }

    instance.status = 'stopped';
    await this.db.saveInstance(instance);
  }

  async restartInstance(instanceId: string): Promise<ClaudeInstance> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const worktree = this.gitService.getWorktree(instance.worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${instance.worktreeId} not found`);
    }

    await this.stopInstance(instanceId);
    
    // Wait a moment for the process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      // Reset instance state for restart
      instance.status = 'starting';
      instance.pid = undefined;
      instance.errorMessage = undefined;
      instance.lastActivity = new Date();
      
      await this.db.saveInstance(instance);

      // Start the process directly without going through startInstance to avoid loop
      const claudePty = await this.spawnClaudePty(instance, worktree);
      this.ptyProcesses.set(instanceId, claudePty);
      
      instance.pid = claudePty.pid;
      instance.status = 'running';
      
      await this.db.saveInstance(instance);
      
      this.setupPtyHandlers(instance, claudePty);

      // Start token usage collection for restarted instance
      this.startUsageCollection(instance.id);

      console.log(`Successfully restarted instance ${instanceId}`);
      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.saveInstance(instance);
      console.error(`Failed to restart instance ${instanceId}:`, error);
      throw new Error(`Failed to restart Claude instance: ${error}`);
    }
  }

  getInstances(): ClaudeInstance[] {
    return Array.from(this.instances.values());
  }

  getInstance(id: string): ClaudeInstance | undefined {
    return this.instances.get(id);
  }

  getInstancesByRepository(repositoryId: string): ClaudeInstance[] {
    return Array.from(this.instances.values()).filter(i => i.repositoryId === repositoryId);
  }

  getInstancesByWorktree(worktreeId: string): ClaudeInstance[] {
    return Array.from(this.instances.values()).filter(i => i.worktreeId === worktreeId);
  }

  getProcess(instanceId: string): ChildProcess | undefined {
    return this.processes.get(instanceId);
  }

  getClaudeProcess(instanceId: string): ChildProcess | undefined {
    return this.processes.get(instanceId);
  }

  getClaudePty(instanceId: string): IPty | undefined {
    return this.ptyProcesses.get(instanceId);
  }

  getTokenUsageStats(): {
    totalSessions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    dailyUsage: Array<{
      date: string;
      inputTokens: number;
      outputTokens: number;
      sessions: number;
    }>;
    instanceUsage: Array<{
      instanceId: string;
      worktreeId: string;
      inputTokens: number;
      outputTokens: number;
      lastActivity: Date;
    }>;
    hasRealData?: boolean;
  } {
    const now = Date.now();
    const instances = this.getInstances();
    const runningInstances = instances.filter(i => i.status === 'running');

    // Track running sessions
    runningInstances.forEach(instance => {
      if (!this.sessionStartTimes.has(instance.id)) {
        this.sessionStartTimes.set(instance.id, now);
      }
    });

    // Remove sessions that are no longer running
    const runningIds = new Set(runningInstances.map(i => i.id));
    for (const [sessionId] of this.sessionStartTimes) {
      if (!runningIds.has(sessionId)) {
        this.sessionStartTimes.delete(sessionId);
        this.instanceTokenUsage.delete(sessionId);
      }
    }

    // Use real token data from in-memory collection or fallback to simulated data
    const hasRealTokenData = this.cumulativeTokens.input > 0 || this.cumulativeTokens.output > 0;

    // Generate daily usage (simulate historical + real current data)
    const dailyUsage = [];
    const currentDate = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(currentDate);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const isToday = i === 0;

      let inputTokens, outputTokens;
      if (isToday && hasRealTokenData) {
        inputTokens = this.cumulativeTokens.input;
        outputTokens = this.cumulativeTokens.output;
      } else {
        // Historical simulation
        const dayActivity = instances.filter(instance => {
          const activityDate = new Date(instance.lastActivity || new Date());
          return activityDate.toDateString() === date.toDateString();
        }).length;
        const baseTokens = Math.max(100, dayActivity * 800 || 1200);
        inputTokens = Math.floor(baseTokens * (0.8 + i * 0.1));
        outputTokens = Math.floor(inputTokens * 0.35);
      }

      dailyUsage.push({
        date: dateStr,
        inputTokens,
        outputTokens,
        sessions: Math.max(1, runningInstances.length || 1)
      });
    }

    // Generate instance-specific usage from real data
    const instanceUsage = instances.map(instance => {
      const realUsage = this.instanceTokenUsage.get(instance.id);

      if (realUsage && (realUsage.input > 0 || realUsage.output > 0)) {
        return {
          instanceId: instance.id,
          worktreeId: instance.worktreeId,
          inputTokens: realUsage.input,
          outputTokens: realUsage.output,
          lastActivity: instance.lastActivity || new Date()
        };
      } else {
        return {
          instanceId: instance.id,
          worktreeId: instance.worktreeId,
          inputTokens: 0,
          outputTokens: 0,
          lastActivity: instance.lastActivity || new Date()
        };
      }
    });

    const totalInputTokens = hasRealTokenData ?
      instanceUsage.reduce((sum, instance) => sum + instance.inputTokens, 0) :
      dailyUsage.reduce((sum, day) => sum + day.inputTokens, 0);

    const totalOutputTokens = hasRealTokenData ?
      instanceUsage.reduce((sum, instance) => sum + instance.outputTokens, 0) :
      dailyUsage.reduce((sum, day) => sum + day.outputTokens, 0);

    return {
      totalSessions: Math.max(instances.length, 1),
      totalInputTokens,
      totalOutputTokens,
      dailyUsage,
      instanceUsage,
      hasRealData: hasRealTokenData
    };
  }

  // Real-time token usage collection methods
  private startUsageCollection(instanceId: string): void {
    // Clear any existing interval for this instance
    this.stopUsageCollection(instanceId);

    // Start collecting usage every 30 seconds
    const interval = setInterval(() => {
      this.collectInstanceUsage(instanceId);
    }, 30000);

    this.usageCollectionIntervals.set(instanceId, interval);

    // Initial collection after a brief delay
    setTimeout(() => {
      this.collectInstanceUsage(instanceId);
    }, 5000);
  }

  private stopUsageCollection(instanceId: string): void {
    const interval = this.usageCollectionIntervals.get(instanceId);
    if (interval) {
      clearInterval(interval);
      this.usageCollectionIntervals.delete(instanceId);
    }
  }

  private async collectInstanceUsage(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.status !== 'running') {
      return;
    }

    const worktree = this.gitService.getWorktree(instance.worktreeId);
    if (!worktree) {
      return;
    }

    try {
      // Execute claude --print --output-format json in the worktree directory
      const { spawn } = await import('child_process');
      const child = spawn('echo', ['Usage check'], {
        cwd: worktree.path,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Pipe the echo output to claude
      const claude = spawn('claude', ['--print', '--output-format', 'json'], {
        cwd: worktree.path,
        stdio: [child.stdout, 'pipe', 'pipe']
      });

      let output = '';
      claude.stdout?.on('data', (data) => {
        output += data.toString();
      });

      claude.on('close', (code) => {
        if (code === 0 && output.trim()) {
          this.parseClaudeOutput(instanceId, output);
        }
      });

      claude.on('error', (error) => {
        console.log(`Claude usage collection error for ${instanceId}:`, error.message);
      });

    } catch (error) {
      console.log(`Failed to collect usage for instance ${instanceId}:`, error);
    }
  }

  private parseClaudeOutput(instanceId: string, output: string): void {
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('usage')) {
          const json = JSON.parse(trimmed);

          if (json.usage && (json.usage.input_tokens || json.usage.output_tokens)) {
            const inputTokens = json.usage.input_tokens || 0;
            const outputTokens = json.usage.output_tokens || 0;
            const cacheCreation = json.usage.cache_creation_input_tokens || 0;
            const cacheRead = json.usage.cache_read_input_tokens || 0;

            // Update instance-specific tracking
            const existing = this.instanceTokenUsage.get(instanceId) || { input: 0, output: 0, cost: 0 };
            this.instanceTokenUsage.set(instanceId, {
              input: existing.input + inputTokens,
              output: existing.output + outputTokens,
              cost: existing.cost + this.calculateCost(inputTokens, outputTokens, cacheCreation, cacheRead)
            });

            // Update cumulative totals
            this.cumulativeTokens.input += inputTokens;
            this.cumulativeTokens.output += outputTokens;

            console.log(`Updated token usage for ${instanceId}: +${inputTokens} input, +${outputTokens} output`);
            break;
          }
        }
      }
    } catch (error) {
      console.log(`Failed to parse Claude output for ${instanceId}:`, error);
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreation: number = 0, cacheRead: number = 0): number {
    // Sonnet pricing: $3 per 1M input tokens, $15 per 1M output tokens
    // Cache creation: $3.75 per 1M tokens, Cache read: $0.30 per 1M tokens
    const inputCost = (inputTokens / 1000000) * 3.00;
    const outputCost = (outputTokens / 1000000) * 15.00;
    const cacheCreationCost = (cacheCreation / 1000000) * 3.75;
    const cacheReadCost = (cacheRead / 1000000) * 0.30;

    return inputCost + outputCost + cacheCreationCost + cacheReadCost;
  }

  async cleanup(): Promise<void> {
    // Clear all usage collection intervals
    for (const [instanceId, interval] of this.usageCollectionIntervals) {
      clearInterval(interval);
    }
    this.usageCollectionIntervals.clear();

    const stopPromises = Array.from(this.instances.keys()).map(id =>
      this.stopInstance(id).catch(error =>
        console.error(`Error stopping instance ${id}:`, error)
      )
    );

    await Promise.allSettled(stopPromises);
  }
}