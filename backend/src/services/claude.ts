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

  async cleanup(): Promise<void> {
    const stopPromises = Array.from(this.instances.keys()).map(id => 
      this.stopInstance(id).catch(error => 
        console.error(`Error stopping instance ${id}:`, error)
      )
    );
    
    await Promise.allSettled(stopPromises);
  }
}