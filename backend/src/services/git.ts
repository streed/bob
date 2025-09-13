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

  async createWorktree(repositoryId: string, branchName: string, baseBranch = 'main'): Promise<Worktree> {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
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
}