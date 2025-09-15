import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { Repository, Worktree } from '../types.js';
import { DatabaseService } from '../database/database.js';

const execAsync = promisify(exec);

export class GitService {
  private repositories = new Map<string, Repository>();
  private worktrees = new Map<string, Worktree>();

  constructor(private db: DatabaseService) {
    this.loadFromDatabase();
  }

  private async loadFromDatabase(): Promise<void> {
    const repos = await this.db.getAllRepositories();
    repos.forEach(repo => {
      this.repositories.set(repo.id, repo);
      repo.worktrees.forEach(worktree => {
        this.worktrees.set(worktree.id, worktree);
      });
    });
  }

  async addRepository(repositoryPath: string): Promise<Repository> {
    if (!existsSync(repositoryPath)) {
      throw new Error(`Directory ${repositoryPath} does not exist`);
    }

    const gitDir = join(repositoryPath, '.git');
    if (!existsSync(gitDir)) {
      throw new Error(`${repositoryPath} is not a git repository`);
    }

    const repo = await this.createRepositoryFromPath(repositoryPath);
    if (!repo) {
      throw new Error(`Failed to create repository from ${repositoryPath}`);
    }

    this.repositories.set(repo.id, repo);
    await this.db.saveRepository(repo);
    
    for (const worktree of repo.worktrees) {
      await this.db.saveWorktree(worktree);
    }
    
    return repo;
  }

  private async createRepositoryFromPath(repoPath: string): Promise<Repository | null> {
    try {
      const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: repoPath });
      const currentBranch = branchOutput.trim();

      const repoId = Buffer.from(repoPath).toString('base64');
      const repo: Repository = {
        id: repoId,
        name: basename(repoPath),
        path: repoPath,
        branch: currentBranch,
        worktrees: []
      };

      const existingWorktrees = await this.loadWorktrees(repo);
      repo.worktrees = existingWorktrees;

      return repo;
    } catch (error) {
      console.error(`Error creating repository from ${repoPath}:`, error);
      return null;
    }
  }

  private async loadWorktrees(repository: Repository): Promise<Worktree[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: repository.path });
      const worktrees: Worktree[] = [];
      const lines = stdout.trim().split('\n');

      let currentWorktree: Partial<Worktree> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const path = line.substring(9);
          currentWorktree.path = path;
        } else if (line.startsWith('branch ')) {
          const branch = line.substring(7);
          currentWorktree.branch = branch;
        } else if (line === '') {
          if (currentWorktree.path && currentWorktree.branch) {
            const worktreeId = Buffer.from(currentWorktree.path).toString('base64');
            const worktree: Worktree = {
              id: worktreeId,
              path: currentWorktree.path,
              branch: currentWorktree.branch,
              repositoryId: repository.id,
              state: 'working',
              instances: []
            };
            worktrees.push(worktree);
            this.worktrees.set(worktreeId, worktree);
          }
          currentWorktree = {};
        }
      }

      if (currentWorktree.path && currentWorktree.branch) {
        const worktreeId = Buffer.from(currentWorktree.path).toString('base64');
        const worktree: Worktree = {
          id: worktreeId,
          path: currentWorktree.path,
          branch: currentWorktree.branch,
          repositoryId: repository.id,
          state: 'working',
          instances: []
        };
        worktrees.push(worktree);
        this.worktrees.set(worktreeId, worktree);
      }

      return worktrees;
    } catch (error) {
      console.error(`Error loading worktrees for ${repository.path}:`, error);
      return [];
    }
  }

  async createWorktree(repositoryId: string, branchName: string, baseBranch?: string): Promise<Worktree> {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    // Auto-detect default branch if not provided
    if (!baseBranch) {
      try {
        const { stdout: defaultBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', {
          cwd: repository.path
        });
        baseBranch = defaultBranch.trim();
      } catch (error) {
        // Fallback: try main, then master
        try {
          await execAsync('git show-ref --verify --quiet refs/heads/main', {
            cwd: repository.path
          });
          baseBranch = 'main';
        } catch {
          try {
            await execAsync('git show-ref --verify --quiet refs/heads/master', {
              cwd: repository.path
            });
            baseBranch = 'master';
          } catch {
            throw new Error('Could not determine default branch (tried HEAD, main, master)');
          }
        }
      }
    }

    // Create worktrees in ~/.bob directory
    const bobDir = join(homedir(), '.bob');
    if (!existsSync(bobDir)) {
      mkdirSync(bobDir, { recursive: true });
    }

    const worktreePath = join(bobDir, `${repository.name}-${branchName}`);

    try {
      await execAsync(`git worktree add "${worktreePath}" -b "${branchName}" "${baseBranch}"`, {
        cwd: repository.path
      });

      const worktreeId = Buffer.from(worktreePath).toString('base64');
      const worktree: Worktree = {
        id: worktreeId,
        path: worktreePath,
        branch: branchName,
        repositoryId,
        state: 'working',
        instances: []
      };

      this.worktrees.set(worktreeId, worktree);
      repository.worktrees.push(worktree);
      
      await this.db.saveWorktree(worktree);

      return worktree;
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  async checkBranchMergeStatus(worktreeId: string): Promise<{ isMerged: boolean; targetBranch: string }> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    const repository = this.repositories.get(worktree.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${worktree.repositoryId} not found`);
    }

    try {
      // Check if branch is merged into main
      const { stdout: mergedOutput } = await execAsync(
        `git branch --merged main`, 
        { cwd: repository.path }
      );
      
      const branchName = worktree.branch.replace(/^refs\/heads\//, '');
      const isMerged = mergedOutput.includes(branchName);
      
      return { isMerged, targetBranch: 'main' };
    } catch (error) {
      // If main doesn't exist, try master
      try {
        const { stdout: mergedOutput } = await execAsync(
          `git branch --merged master`, 
          { cwd: repository.path }
        );
        
        const branchName = worktree.branch.replace(/^refs\/heads\//, '');
        const isMerged = mergedOutput.includes(branchName);
        
        return { isMerged, targetBranch: 'master' };
      } catch (masterError) {
        throw new Error(`Failed to check merge status: ${error}`);
      }
    }
  }

  async removeWorktree(worktreeId: string, force: boolean = false): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    const repository = this.repositories.get(worktree.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${worktree.repositoryId} not found`);
    }

    // Check for active instances (running or starting)
    const activeInstances = worktree.instances.filter(i => i.status === 'running' || i.status === 'starting');
    if (activeInstances.length > 0 && !force) {
      throw new Error('Cannot remove worktree with active instances. Stop all Claude instances first.');
    }

    // Check if branch is merged unless forcing deletion
    if (!force) {
      const { isMerged } = await this.checkBranchMergeStatus(worktreeId);
      if (!isMerged) {
        throw new Error('Branch has not been merged into main. Use force deletion if you want to delete anyway.');
      }
    }

    try {
      // If force deletion, first revert any uncommitted changes in the worktree
      if (force) {
        try {
          console.log(`Force deletion: reverting uncommitted changes in ${worktree.path}`);

          // Check if there are any changes to revert
          const { stdout: status } = await execAsync('git status --porcelain', { cwd: worktree.path });

          if (status.trim()) {
            // Revert all changes: unstaged, staged, and untracked files
            await execAsync('git reset --hard HEAD', { cwd: worktree.path });
            await execAsync('git clean -fd', { cwd: worktree.path });
            console.log(`Successfully reverted all changes in ${worktree.path}`);
          } else {
            console.log(`No changes to revert in ${worktree.path}`);
          }
        } catch (revertError) {
          console.warn(`Warning: Could not revert changes in ${worktree.path}: ${revertError}`);
          // Continue with deletion even if revert fails
        }
      }

      // First try to remove the worktree
      await execAsync(`git worktree remove "${worktree.path}"`, { cwd: repository.path });

      // If force deletion and branch exists, delete the branch too
      if (force) {
        try {
          const branchName = worktree.branch.replace(/^refs\/heads\//, '');
          await execAsync(`git branch -D "${branchName}"`, { cwd: repository.path });
        } catch (branchError) {
          console.warn(`Warning: Could not delete branch ${worktree.branch}: ${branchError}`);
        }
      }
      
      this.worktrees.delete(worktreeId);
      repository.worktrees = repository.worktrees.filter(w => w.id !== worktreeId);
      
      await this.db.deleteWorktree(worktreeId);
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error}`);
    }
  }

  getRepositories(): Repository[] {
    return Array.from(this.repositories.values());
  }

  getRepository(id: string): Repository | undefined {
    return this.repositories.get(id);
  }

  getWorktree(id: string): Worktree | undefined {
    return this.worktrees.get(id);
  }

  getWorktreesByRepository(repositoryId: string): Worktree[] {
    return Array.from(this.worktrees.values()).filter(w => w.repositoryId === repositoryId);
  }

  async checkPRStatus(worktreeId: string): Promise<{ hasPR: boolean; prUrl?: string; isMerged?: boolean }> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    const repository = this.repositories.get(worktree.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${worktree.repositoryId} not found`);
    }

    try {
      // Get current branch name
      const { stdout: currentBranch } = await execAsync('git branch --show-current', {
        cwd: worktree.path
      });
      const branchName = currentBranch.trim();

      // Check if PR exists for this branch using GitHub CLI
      const { stdout: prInfo } = await execAsync(`gh pr list --head ${branchName} --json number,url,state`, {
        cwd: repository.path
      });

      const prs = JSON.parse(prInfo);
      if (prs.length === 0) {
        return { hasPR: false };
      }

      const pr = prs[0];
      return {
        hasPR: true,
        prUrl: pr.url,
        isMerged: pr.state === 'MERGED'
      };
    } catch (error) {
      // GitHub CLI not available or other error - fall back to no PR status
      console.warn(`Could not check PR status for worktree ${worktreeId}:`, error);
      return { hasPR: false };
    }
  }

  async updateWorktreeState(worktreeId: string, newState: 'working' | 'review' | 'done', prUrl?: string): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    // Update in-memory state
    worktree.state = newState;
    if (prUrl) {
      worktree.prUrl = prUrl;
    }

    // Update in database
    await this.db.updateWorktreeState(worktreeId, newState, prUrl);
  }

  async performPeriodicStateCheck(): Promise<{ updated: number; errors: string[] }> {
    let updated = 0;
    const errors: string[] = [];

    // Check all worktrees that are not in 'done' state
    const activeWorktrees = Array.from(this.worktrees.values()).filter(w => w.state !== 'done');

    for (const worktree of activeWorktrees) {
      try {
        // Update merge check timestamp
        await this.db.updateWorktreeMergeCheck(worktree.id);
        
        // Check if branch is merged
        const { isMerged } = await this.checkBranchMergeStatus(worktree.id);
        
        if (isMerged && worktree.state !== 'done') {
          await this.updateWorktreeState(worktree.id, 'done');
          updated++;
          console.log(`Worktree ${worktree.id} (${worktree.branch}) marked as done - branch merged`);
          continue;
        }

        // Check PR status if branch not merged
        if (!isMerged) {
          const { hasPR, prUrl, isMerged: prMerged } = await this.checkPRStatus(worktree.id);
          
          if (prMerged && worktree.state !== 'done') {
            await this.updateWorktreeState(worktree.id, 'done', prUrl);
            updated++;
            console.log(`Worktree ${worktree.id} (${worktree.branch}) marked as done - PR merged`);
          } else if (hasPR && worktree.state === 'working') {
            await this.updateWorktreeState(worktree.id, 'review', prUrl);
            updated++;
            console.log(`Worktree ${worktree.id} (${worktree.branch}) marked as in review - PR opened`);
          }
        }
      } catch (error) {
        const errorMsg = `Error checking state for worktree ${worktree.id}: ${error}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return { updated, errors };
  }
}