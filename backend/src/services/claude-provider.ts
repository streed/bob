import { spawn, ChildProcess } from 'child_process';
import { spawn as spawnPty, IPty } from 'node-pty';
import { ClaudeInstance, Worktree } from '../types.js';
import { LLMProvider } from './llm.js';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'Claude';
  readonly command = 'claude';

  async checkAvailability(): Promise<{ status: string; version?: string }> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('claude --version');
      return {
        status: 'available',
        version: stdout.trim()
      };
    } catch (error) {
      return {
        status: 'not_available'
      };
    }
  }

  async spawnProcess(instance: ClaudeInstance, worktree: Worktree): Promise<ChildProcess> {
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
        const MAX_OUTPUT_LENGTH = 10000;
        output += dataStr;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }
        if (dataStr.length < 100 && (dataStr.includes('Claude') || dataStr.includes('error') || dataStr.includes('Error'))) {
          console.log(`Claude ${instance.id} stdout:`, dataStr.substring(0, 200));
        }
      });

      claudeProcess.stderr?.on('data', (data) => {
        const dataStr = data.toString();
        const MAX_OUTPUT_LENGTH = 10000;
        errorOutput += dataStr;
        if (errorOutput.length > MAX_OUTPUT_LENGTH) {
          errorOutput = errorOutput.slice(-MAX_OUTPUT_LENGTH / 2);
        }
        console.error(`Claude ${instance.id} stderr:`, dataStr.substring(0, 500));
      });

      claudeProcess.on('spawn', () => {
        console.log(`Process spawned for Claude instance ${instance.id} with PID ${claudeProcess.pid}`);
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

      const timeout = setTimeout(() => {
        if (!spawned) {
          claudeProcess.kill('SIGTERM');
          reject(new Error(`Claude Code process failed to start within timeout. Output: ${output}, Error: ${errorOutput}`));
        }
      }, 10000);

      claudeProcess.on('spawn', () => {
        setTimeout(() => {
          if (spawned) {
            clearTimeout(timeout);
          }
        }, 3100);
      });
    });
  }

  async spawnPty(instance: ClaudeInstance, worktree: Worktree): Promise<IPty> {
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
        const MAX_OUTPUT_LENGTH = 10000;
        output += data;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }

        if (data.length < 100 && (data.includes('Claude') || data.includes('error') || data.includes('Error'))) {
          console.log(`Claude PTY ${instance.id} output:`, data.substring(0, 200));
        }

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

  async executeCommand(prompt: string, workingDirectory: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const claudeProcess = spawn('claude', [prompt], {
        cwd: workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: process.env.PATH
        }
      });

      let output = '';
      let errorOutput = '';
      const timeout = setTimeout(() => {
        claudeProcess.kill('SIGTERM');
        reject(new Error('Claude command timed out'));
      }, 30000);

      claudeProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      claudeProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      claudeProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Claude command failed with code ${code}: ${errorOutput}`));
        }
      });

      claudeProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      claudeProcess.stdin.write(`"${prompt}"`);
      claudeProcess.stdin.end();
    });
  }

  parseUsageOutput(output: string): { input?: number; output?: number; cost?: number } | null {
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('usage')) {
          const json = JSON.parse(trimmed);

          if (json.usage && (json.usage.input_tokens || json.usage.output_tokens)) {
            const inputTokens = json.usage.input_tokens || 0;
            const outputTokens = json.usage.output_tokens || 0;
            const cacheCreation = json.usage.cache_creation_input_tokens || 0;
            const cacheRead = json.usage.cache_read_input_tokens || 0;

            return {
              input: inputTokens,
              output: outputTokens,
              cost: this.calculateCost(inputTokens, outputTokens, cacheCreation, cacheRead)
            };
          }
        }
      }
    } catch (error) {
      console.log(`Failed to parse Claude usage output:`, error);
    }
    return null;
  }

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreation: number = 0, cacheRead: number = 0): number {
    // Sonnet pricing: $3 per 1M input tokens, $15 per 1M output tokens
    // Cache creation: $3.75 per 1M tokens, Cache read: $0.30 per 1M tokens
    const inputCost = (inputTokens / 1000000) * 3.00;
    const outputCost = (outputTokens / 1000000) * 15.00;
    const cacheCreationCost = (cacheCreation / 1000000) * 3.75;
    const cacheReadCost = (cacheRead / 1000000) * 0.30;

    return inputCost + outputCost + cacheCreationCost + cacheReadCost;
  }
}