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
  state: 'working' | 'review' | 'done';
  prUrl?: string;
  lastMergeCheck?: string;
}

export interface ClaudeInstance {
  id: string;
  worktreeId: string;
  repositoryId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  pid?: number;
  port?: number;
  createdAt: string;
  lastActivity?: string;
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