import { GitService } from './git.js';
import { ClaudeService } from './claude.js';

export class WorktreeStateService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;

  constructor(
    private gitService: GitService,
    private claudeService: ClaudeService,
    checkIntervalMinutes: number = 10 // Default to check every 10 minutes
  ) {
    this.checkIntervalMs = checkIntervalMinutes * 60 * 1000;
  }

  start(): void {
    if (this.intervalId) {
      console.log('Worktree state service is already running');
      return;
    }

    console.log(`Starting worktree state service (checking every ${this.checkIntervalMs / 60000} minutes)`);
    
    // Run initial check
    this.performStateCheck();
    
    // Set up periodic checks
    this.intervalId = setInterval(() => {
      this.performStateCheck();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      console.log('Stopping worktree state service');
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async performStateCheck(): Promise<void> {
    try {
      console.log('Performing periodic worktree state check...');
      
      const result = await this.gitService.performPeriodicStateCheck();
      
      if (result.updated > 0) {
        console.log(`Updated ${result.updated} worktree states`);
        
        // Stop Claude instances for worktrees that are now done
        await this.stopInstancesForCompletedWorktrees();
      }
      
      if (result.errors.length > 0) {
        console.warn(`State check completed with ${result.errors.length} errors:`, result.errors);
      } else {
        console.log('State check completed successfully');
      }
    } catch (error) {
      console.error('Error during periodic state check:', error);
    }
  }

  private async stopInstancesForCompletedWorktrees(): Promise<void> {
    try {
      const repositories = this.gitService.getRepositories();
      
      for (const repo of repositories) {
        for (const worktree of repo.worktrees) {
          if (worktree.state === 'done' && worktree.instances.length > 0) {
            for (const instance of worktree.instances) {
              if (instance.status === 'running' || instance.status === 'starting') {
                console.log(`Stopping Claude instance ${instance.id} for completed worktree ${worktree.id} (${worktree.branch})`);
                try {
                  await this.claudeService.stopInstance(instance.id);
                } catch (stopError) {
                  console.error(`Failed to stop instance ${instance.id}:`, stopError);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error stopping instances for completed worktrees:', error);
    }
  }

  async forceStateCheck(): Promise<{ updated: number; errors: string[] }> {
    console.log('Performing manual worktree state check...');
    const result = await this.gitService.performPeriodicStateCheck();
    
    if (result.updated > 0) {
      await this.stopInstancesForCompletedWorktrees();
    }
    
    return result;
  }
}