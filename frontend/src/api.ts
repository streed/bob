import { Repository, ClaudeInstance, CreateWorktreeRequest, StartInstanceRequest, Worktree } from './types';

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
}

export const api = new ApiClient();