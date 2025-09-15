export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  worktrees: Worktree[];
}

export interface Worktree {
  id: string;
  path: string;
  branch: string;
  repositoryId: string;
  instances: ClaudeInstance[];
}

export interface ClaudeInstance {
  id: string;
  worktreeId: string;
  repositoryId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  pid?: number;
  port?: number;
  createdAt: Date;
  lastActivity?: Date;
  errorMessage?: string;
}

export interface CreateWorktreeRequest {
  repositoryId: string;
  branchName: string;
  baseBranch?: string;
}

export interface StartInstanceRequest {
  worktreeId: string;
  repositoryId: string;
}