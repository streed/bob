import { Repository, ClaudeInstance, Worktree } from './types';

const API_BASE = '/api';

class ApiClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async getRepositories(): Promise<Repository[]> {
    return this.request('/repositories');
  }

  async addRepository(repositoryPath: string): Promise<Repository> {
    return this.request('/repositories/add', {
      method: 'POST',
      body: JSON.stringify({ repositoryPath }),
    });
  }

  async getRepository(id: string): Promise<Repository> {
    return this.request(`/repositories/${id}`);
  }

  async createWorktree(repositoryId: string, branchName: string, baseBranch?: string): Promise<Worktree> {
    return this.request(`/repositories/${repositoryId}/worktrees`, {
      method: 'POST',
      body: JSON.stringify({ branchName, baseBranch }),
    });
  }

  async checkWorktreeMergeStatus(worktreeId: string): Promise<{ isMerged: boolean; targetBranch: string }> {
    return this.request(`/repositories/worktrees/${worktreeId}/merge-status`);
  }

  async removeWorktree(worktreeId: string, force: boolean = false): Promise<void> {
    return this.request(`/repositories/worktrees/${worktreeId}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    });
  }

  async getInstances(): Promise<ClaudeInstance[]> {
    return this.request('/instances');
  }

  async getInstancesByRepository(repositoryId: string): Promise<ClaudeInstance[]> {
    return this.request(`/instances/repository/${repositoryId}`);
  }

  async startInstance(worktreeId: string): Promise<ClaudeInstance> {
    return this.request('/instances', {
      method: 'POST',
      body: JSON.stringify({ worktreeId }),
    });
  }

  async stopInstance(instanceId: string): Promise<void> {
    return this.request(`/instances/${instanceId}`, {
      method: 'DELETE',
    });
  }

  async restartInstance(instanceId: string): Promise<ClaudeInstance> {
    return this.request(`/instances/${instanceId}/restart`, {
      method: 'POST',
    });
  }

  async createTerminalSession(instanceId: string): Promise<{ sessionId: string }> {
    return this.request(`/instances/${instanceId}/terminal`, {
      method: 'POST',
    });
  }

  async createDirectoryTerminalSession(instanceId: string): Promise<{ sessionId: string }> {
    return this.request(`/instances/${instanceId}/terminal/directory`, {
      method: 'POST',
    });
  }

  async getTerminalSessions(instanceId: string): Promise<{ id: string; createdAt: string; type: 'claude' | 'directory' | 'unknown' }[]> {
    return this.request(`/instances/${instanceId}/terminals`);
  }

  async closeTerminalSession(sessionId: string): Promise<void> {
    return this.request(`/instances/terminals/${sessionId}`, {
      method: 'DELETE',
    });
  }

  // Git operations
  async getGitDiff(worktreeId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/git/${worktreeId}/diff`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.text();
  }

  async generateCommitMessage(worktreeId: string, comments?: any[]): Promise<{
    commitMessage: string;
    commitSubject?: string;
    commitBody?: string;
    changedFiles: string[];
    fileCount: number;
    fallback?: boolean;
  }> {
    return this.request(`/git/${worktreeId}/generate-commit-message`, {
      method: 'POST',
      body: JSON.stringify({ comments }),
    });
  }

  async commitChanges(worktreeId: string, message: string): Promise<{
    message: string;
    commitMessage: string;
  }> {
    return this.request(`/git/${worktreeId}/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  async revertChanges(worktreeId: string): Promise<{ message: string }> {
    return this.request(`/git/${worktreeId}/revert`, {
      method: 'POST',
    });
  }

  async createPullRequest(worktreeId: string): Promise<{
    message: string;
    branch: string;
    title: string;
    description?: string;
    pr?: string;
  }> {
    return this.request(`/git/${worktreeId}/create-pr`, {
      method: 'POST',
    });
  }

  async updatePullRequest(worktreeId: string): Promise<{
    message: string;
    prNumber: number;
    title: string;
    description: string;
  }> {
    return this.request(`/git/${worktreeId}/update-pr`, {
      method: 'POST',
    });
  }

  async analyzeDiff(worktreeId: string): Promise<{
    analysis: {
      comments: Array<{
        file: string;
        line: number;
        type: 'suggestion' | 'warning' | 'error';
        message: string;
        severity: 'low' | 'medium' | 'high';
      }>;
      summary: string;
      analysisId: string;
    };
    diffAnalyzed: boolean;
  }> {
    return this.request(`/git/${worktreeId}/analyze-diff`, {
      method: 'POST',
    });
  }

  async getAnalysis(worktreeId: string): Promise<{
    analysis: {
      id: string;
      summary: string;
      timestamp: string;
    } | null;
    comments: Array<{
      id: string;
      file: string;
      line: number;
      type: 'suggestion' | 'warning' | 'error' | 'user';
      message: string;
      severity: 'low' | 'medium' | 'high';
      isAI: boolean;
      userReply?: string;
    }>;
  }> {
    return this.request(`/git/${worktreeId}/analysis`);
  }

  async addComment(worktreeId: string, data: {
    analysisId: string;
    file: string;
    line: number;
    message: string;
  }): Promise<{
    id: string;
    file: string;
    line: number;
    type: 'user';
    message: string;
    severity: 'low';
    isAI: false;
  }> {
    return this.request(`/git/${worktreeId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateComment(worktreeId: string, commentId: string, data: {
    userReply?: string;
    isDismissed?: boolean;
  }): Promise<{ success: boolean }> {
    return this.request(`/git/${worktreeId}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async applyCodeFixes(worktreeId: string): Promise<{
    success: boolean;
    message: string;
    fixesApplied: number;
    filesModified?: number;
    error?: string;
    details?: string;
    suggestion?: string;
  }> {
    return this.request(`/git/${worktreeId}/apply-fixes`, {
      method: 'POST',
    });
  }

  // System status and metrics
  async getSystemStatus(): Promise<{
    claude: {
      status: 'available' | 'not_available' | 'unknown';
      version: string;
    };
    github: {
      status: 'available' | 'not_available' | 'not_authenticated' | 'unknown';
      version: string;
      user: string;
    };
    metrics: {
      repositories: number;
      worktrees: number;
      totalInstances: number;
      activeInstances: number;
    };
    server: {
      uptime: number;
      memory: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
      };
      nodeVersion: string;
    };
  }> {
    return this.request('/system-status');
  }

  // Worktree state management
  async checkWorktreeStates(): Promise<{ updated: number; errors: string[] }> {
    return this.request('/repositories/check-states', {
      method: 'POST',
    });
  }

  async updateWorktreeState(worktreeId: string, state: 'working' | 'review' | 'done', prUrl?: string): Promise<Worktree> {
    return this.request(`/repositories/worktrees/${worktreeId}/state`, {
      method: 'PUT',
      body: JSON.stringify({ state, prUrl }),
    });
  }

  async checkPRStatus(worktreeId: string): Promise<{ hasPR: boolean; prUrl?: string; isMerged?: boolean }> {
    return this.request(`/repositories/worktrees/${worktreeId}/pr-status`);
  }
}

export const api = new ApiClient();