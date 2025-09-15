import { ChildProcess } from 'child_process';
import { IPty } from 'node-pty';
import { ClaudeInstance, Worktree } from '../types.js';
import { GitService } from './git.js';
import { DatabaseService } from '../database/database.js';
import { LLMProviderRegistry, LLMProviderType, LLMProvider } from './llm.js';
import { ClaudeProvider } from './claude-provider.js';
import { CodexProvider } from './codex-provider.js';

export class LLMService {
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
    // Register LLM providers
    LLMProviderRegistry.register('claude', new ClaudeProvider());
    LLMProviderRegistry.register('codex', new CodexProvider());
    
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

  async startInstance(worktreeId: string, provider: LLMProviderType = 'claude'): Promise<ClaudeInstance> {
    const worktree = this.gitService.getWorktree(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    // Get the provider implementation
    const llmProvider = LLMProviderRegistry.get(provider);
    if (!llmProvider) {
      throw new Error(`LLM provider ${provider} not found`);
    }

    // Check if provider is available on the system
    const availability = await llmProvider.checkAvailability();
    if (availability.status !== 'available') {
      throw new Error(`${llmProvider.name} CLI is not available on this system. Please install it first.`);
    }

    // Check for any existing instance (regardless of status)
    const existingInstance = Array.from(this.instances.values())
      .find(i => i.worktreeId === worktreeId);
    
    if (existingInstance) {
      if (existingInstance.status === 'running') {
        throw new Error(`LLM instance already running for this worktree. Stop the existing instance first.`);
      } else if (existingInstance.status === 'starting') {
        throw new Error(`LLM instance is already starting for this worktree. Please wait for it to finish.`);
      } else {
        // If instance exists but is stopped/error, restart it instead of creating new one
        console.log(`Found existing stopped instance ${existingInstance.id}, restarting instead of creating new one`);
        return await this.restartInstance(existingInstance.id);
      }
    }

    const instanceId = `${provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const port = this.nextPort++;

    const instance: ClaudeInstance = {
      id: instanceId,
      worktreeId,
      repositoryId: worktree.repositoryId,
      status: 'starting',
      port,
      createdAt: new Date(),
      lastActivity: new Date(),
      provider
    };

    this.instances.set(instanceId, instance);
    worktree.instances.push(instance);
    
    await this.db.saveInstance(instance);

    try {
      const ptyProcess = await llmProvider.spawnPty(instance, worktree);
      this.ptyProcesses.set(instanceId, ptyProcess);
      
      instance.pid = ptyProcess.pid;
      instance.status = 'running';
      
      await this.db.saveInstance(instance);
      
      this.setupPtyHandlers(instance, ptyProcess);

      // Start token usage collection for this instance
      this.startUsageCollection(instance.id);

      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.saveInstance(instance);
      throw new Error(`Failed to start ${llmProvider.name} instance: ${error}`);
    }
  }

  private setupPtyHandlers(instance: ClaudeInstance, ptyProcess: IPty): void {
    ptyProcess.onExit((exitCode) => {
      console.log(`LLM PTY ${instance.id} exited with code ${exitCode}`);
      instance.status = 'stopped';
      this.ptyProcesses.delete(instance.id);

      // Stop token usage collection
      this.stopUsageCollection(instance.id);

      const worktree = this.gitService.getWorktree(instance.worktreeId);
      if (worktree) {
        worktree.instances = worktree.instances.filter(i => i.id !== instance.id);
      }

      this.instances.delete(instance.id);
      this.db.saveInstance(instance).catch(err => console.error('Failed to save instance:', err));
    });

    ptyProcess.onData((data: string) => {
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
    const ptyProcess = this.ptyProcesses.get(instanceId);
    if (ptyProcess) {
      ptyProcess.kill();
      this.ptyProcesses.delete(instanceId);
    }

    // Handle regular processes (fallback)
    const process = this.processes.get(instanceId);
    if (process && !process.killed) {
      process.removeAllListeners();
      process.stdout?.removeAllListeners();
      process.stderr?.removeAllListeners();
      process.kill('SIGTERM');

      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
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

      // Get the provider and restart
      const provider = LLMProviderRegistry.get(instance.provider || 'claude');
      if (!provider) {
        throw new Error(`Provider ${instance.provider} not found`);
      }

      const ptyProcess = await provider.spawnPty(instance, worktree);
      this.ptyProcesses.set(instanceId, ptyProcess);
      
      instance.pid = ptyProcess.pid;
      instance.status = 'running';
      
      await this.db.saveInstance(instance);
      
      this.setupPtyHandlers(instance, ptyProcess);

      // Start token usage collection for restarted instance
      this.startUsageCollection(instance.id);

      console.log(`Successfully restarted instance ${instanceId}`);
      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.saveInstance(instance);
      console.error(`Failed to restart instance ${instanceId}:`, error);
      throw new Error(`Failed to restart LLM instance: ${error}`);
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

  getPty(instanceId: string): IPty | undefined {
    return this.ptyProcesses.get(instanceId);
  }

  // Execute LLM command using the specified provider
  async executeCommand(prompt: string, workingDirectory: string, provider: LLMProviderType = 'claude'): Promise<string> {
    const llmProvider = LLMProviderRegistry.get(provider);
    if (!llmProvider) {
      throw new Error(`LLM provider ${provider} not found`);
    }

    return await llmProvider.executeCommand(prompt, workingDirectory);
  }

  // Get available providers
  getAvailableProviders(): LLMProviderType[] {
    return LLMProviderRegistry.getAvailable();
  }

  // Check availability of all providers
  async checkProviderAvailability(): Promise<Record<LLMProviderType, { status: string; version?: string }>> {
    const providers = LLMProviderRegistry.getAll();
    const results: Record<LLMProviderType, { status: string; version?: string }> = {} as any;

    for (const [type, provider] of providers) {
      results[type] = await provider.checkAvailability();
    }

    return results;
  }

  // Token usage and collection methods (similar to original ClaudeService)
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
    const runningInstances = instances.filter(i => i.status === 'running' || i.status === 'starting');

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

    // Clean up token usage data for this instance
    this.instanceTokenUsage.delete(instanceId);
    this.sessionStartTimes.delete(instanceId);
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

    const provider = LLMProviderRegistry.get(instance.provider || 'claude');
    if (!provider) {
      return;
    }

    try {
      // Try to collect usage using provider-specific command
      const { spawn } = await import('child_process');
      const child = spawn('echo', ['Usage check'], {
        cwd: worktree.path,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Use the provider's command
      const llmProcess = spawn(provider.command, ['--print', '--output-format', 'json'], {
        cwd: worktree.path,
        stdio: [child.stdout, 'pipe', 'pipe']
      });

      let output = '';
      llmProcess.stdout?.on('data', (data) => {
        const MAX_OUTPUT_LENGTH = 50000;
        output += data.toString();
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }
      });

      llmProcess.on('close', (code) => {
        if (code === 0 && output.trim() && provider.parseUsageOutput) {
          const usage = provider.parseUsageOutput(output);
          if (usage) {
            this.updateInstanceUsage(instanceId, usage);
          }
        }
      });

      llmProcess.on('error', (error) => {
        console.log(`${provider.name} usage collection error for ${instanceId}:`, error.message);
      });

    } catch (error) {
      console.log(`Failed to collect usage for instance ${instanceId}:`, error);
    }
  }

  private updateInstanceUsage(instanceId: string, usage: { input?: number; output?: number; cost?: number }): void {
    const existing = this.instanceTokenUsage.get(instanceId) || { input: 0, output: 0, cost: 0 };
    this.instanceTokenUsage.set(instanceId, {
      input: existing.input + (usage.input || 0),
      output: existing.output + (usage.output || 0),
      cost: existing.cost + (usage.cost || 0)
    });

    // Update cumulative totals
    this.cumulativeTokens.input += usage.input || 0;
    this.cumulativeTokens.output += usage.output || 0;

    console.log(`Updated token usage for ${instanceId}: +${usage.input || 0} input, +${usage.output || 0} output`);
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