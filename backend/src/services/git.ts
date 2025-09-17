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
      const mainBranch = await this.detectMainBranch(repoPath);

      const repoId = Buffer.from(repoPath).toString('base64');
      const repo: Repository = {
        id: repoId,
        name: basename(repoPath),
        path: repoPath,
        branch: currentBranch,
        mainBranch: mainBranch,
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

  private async detectMainBranch(repoPath: string): Promise<string> {
    try {
      // First try to get the default branch from the remote
      try {
        const { stdout: defaultBranch } = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoPath });
        const branch = defaultBranch.trim().replace('refs/remotes/origin/', '');
        if (branch) return branch;
      } catch {
        // If that fails, try to determine from existing branches
      }

      // Check if 'main' exists
      try {
        await execAsync('git show-ref --verify --quiet refs/heads/main', { cwd: repoPath });
        return 'main';
      } catch {
        // 'main' doesn't exist, try 'master'
      }

      // Check if 'master' exists
      try {
        await execAsync('git show-ref --verify --quiet refs/heads/master', { cwd: repoPath });
        return 'master';
      } catch {
        // Neither main nor master exists, try other common names
      }

      // Try other common main branch names
      const commonNames = ['develop', 'development', 'dev'];
      for (const name of commonNames) {
        try {
          await execAsync(`git show-ref --verify --quiet refs/heads/${name}`, { cwd: repoPath });
          return name;
        } catch {
          continue;
        }
      }

      // Fallback: get the current HEAD branch
      const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: repoPath });
      return currentBranch.trim() || 'main';
    } catch (error) {
      console.error(`Error detecting main branch for ${repoPath}:`, error);
      return 'main'; // Safe fallback
    }
  }

  private async loadWorktrees(repository: Repository): Promise<Worktree[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: repository.path });
      const worktrees: Worktree[] = [];
      const lines = stdout.trim().split('\n');

      let currentWorktree: Partial<Worktree> = {};
      let isFirstWorktree = true; // The first worktree is always the main worktree

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const path = line.substring(9);
          currentWorktree.path = path;
        } else if (line.startsWith('branch ')) {
          const branch = line.substring(7);
          currentWorktree.branch = branch;
        } else if (line === '') {
          if (currentWorktree.path && currentWorktree.branch) {
            // Skip the main worktree - Bob should not manage it
            if (!isFirstWorktree) {
              const worktreeId = Buffer.from(currentWorktree.path).toString('base64');
              const worktree: Worktree = {
                id: worktreeId,
                path: currentWorktree.path,
                branch: currentWorktree.branch,
                repositoryId: repository.id,
                instances: [],
                isMainWorktree: false // Only non-main worktrees are managed by Bob
              };
              worktrees.push(worktree);
              this.worktrees.set(worktreeId, worktree);
            }
            isFirstWorktree = false; // Only the first one is the main worktree
          }
          currentWorktree = {};
        }
      }

      // Handle the last worktree if there's no empty line at the end
      if (currentWorktree.path && currentWorktree.branch) {
        // Skip the main worktree - Bob should not manage it
        if (!isFirstWorktree) {
          const worktreeId = Buffer.from(currentWorktree.path).toString('base64');
          const worktree: Worktree = {
            id: worktreeId,
            path: currentWorktree.path,
            branch: currentWorktree.branch,
            repositoryId: repository.id,
            instances: [],
            isMainWorktree: false // Only non-main worktrees are managed by Bob
          };
          worktrees.push(worktree);
          this.worktrees.set(worktreeId, worktree);
        }
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
      baseBranch = repository.mainBranch;
    }

    // Pull the latest changes from the base branch before creating worktree
    try {
      console.log(`Pulling latest changes for ${baseBranch} before creating worktree`);
      await execAsync('git fetch origin', { cwd: repository.path });
      await execAsync(`git pull origin ${baseBranch}`, { cwd: repository.path });
    } catch (error) {
      console.warn(`Warning: Could not pull latest changes for ${baseBranch}: ${error}`);
      // Continue with worktree creation even if pull fails
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
        instances: [],
        isMainWorktree: false
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

  async refreshMainBranch(repositoryId: string): Promise<Repository> {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    try {
      // Fetch latest changes from remote
      await execAsync('git fetch origin', { cwd: repository.path });

      // Pull the main branch to keep it up to date
      await execAsync(`git checkout ${repository.mainBranch}`, { cwd: repository.path });
      await execAsync(`git pull origin ${repository.mainBranch}`, { cwd: repository.path });

      // Update the current branch info
      const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: repository.path });
      repository.branch = branchOutput.trim();

      // Re-detect main branch in case it changed
      repository.mainBranch = await this.detectMainBranch(repository.path);

      // Update database
      await this.db.saveRepository(repository);

      console.log(`Successfully refreshed main branch for repository ${repository.name}`);
      return repository;
    } catch (error) {
      console.error(`Error refreshing main branch for ${repository.name}:`, error);
      throw new Error(`Failed to refresh main branch: ${error instanceof Error ? error.message : error}`);
    }
  }
}