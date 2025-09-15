import { ChildProcess } from 'child_process';
import { IPty } from 'node-pty';
import { ClaudeInstance, Worktree } from '../types.js';

// Abstract interface for LLM providers
export interface LLMProvider {
  readonly name: string;
  readonly command: string;
  
  // Check if the LLM CLI is available on the system
  checkAvailability(): Promise<{ status: string; version?: string }>;
  
  // Spawn the LLM process for a worktree
  spawnProcess(instance: ClaudeInstance, worktree: Worktree): Promise<ChildProcess>;
  
  // Spawn the LLM PTY for a worktree  
  spawnPty(instance: ClaudeInstance, worktree: Worktree): Promise<IPty>;
  
  // Execute LLM command for analysis (git diff, etc.)
  executeCommand(prompt: string, workingDirectory: string): Promise<string>;
  
  // Parse output for token usage (if supported)
  parseUsageOutput?(output: string): { input?: number; output?: number; cost?: number } | null;
}

// Supported LLM provider types
export type LLMProviderType = 'claude' | 'codex';

// Registry for LLM providers
export class LLMProviderRegistry {
  private static providers = new Map<LLMProviderType, LLMProvider>();
  
  static register(type: LLMProviderType, provider: LLMProvider): void {
    this.providers.set(type, provider);
  }
  
  static get(type: LLMProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }
  
  static getAll(): Map<LLMProviderType, LLMProvider> {
    return new Map(this.providers);
  }
  
  static getAvailable(): LLMProviderType[] {
    return Array.from(this.providers.keys());
  }
}