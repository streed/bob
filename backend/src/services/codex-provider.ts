import { spawn, ChildProcess } from 'child_process';
import { spawn as spawnPty, IPty } from 'node-pty';
import { ClaudeInstance, Worktree } from '../types.js';
import { LLMProvider } from './llm.js';

export class CodexProvider implements LLMProvider {
  readonly name = 'Codex';
  readonly command = 'codex';

  async checkAvailability(): Promise<{ status: string; version?: string }> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('codex --version');
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
      console.log(`Starting Codex Code in directory: ${worktree.path}`);
      
      const codexProcess = spawn('codex', [], {
        cwd: worktree.path,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: {
          ...process.env,
          CODEX_CODE_PORT: instance.port?.toString(),
          PATH: process.env.PATH
        }
      });

      let spawned = false;
      let output = '';
      let errorOutput = '';

      codexProcess.stdout?.on('data', (data) => {
        const dataStr = data.toString();
        const MAX_OUTPUT_LENGTH = 10000;
        output += dataStr;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }
        if (dataStr.length < 100 && (dataStr.includes('Codex') || dataStr.includes('error') || dataStr.includes('Error'))) {
          console.log(`Codex ${instance.id} stdout:`, dataStr.substring(0, 200));
        }
      });

      codexProcess.stderr?.on('data', (data) => {
        const dataStr = data.toString();
        const MAX_OUTPUT_LENGTH = 10000;
        errorOutput += dataStr;
        if (errorOutput.length > MAX_OUTPUT_LENGTH) {
          errorOutput = errorOutput.slice(-MAX_OUTPUT_LENGTH / 2);
        }
        console.error(`Codex ${instance.id} stderr:`, dataStr.substring(0, 500));
      });

      codexProcess.on('spawn', () => {
        console.log(`Process spawned for Codex instance ${instance.id} with PID ${codexProcess.pid}`);
        setTimeout(() => {
          if (!spawned && !codexProcess.killed) {
            spawned = true;
            console.log(`Codex Code assumed ready for worktree ${worktree.path}`);
            resolve(codexProcess);
          }
        }, 3000);
      });

      codexProcess.on('error', (error) => {
        console.error(`Failed to start Codex Code process:`, error);
        if (!spawned) {
          reject(error);
        }
      });

      codexProcess.on('exit', (code, signal) => {
        console.log(`Codex process exited with code ${code}, signal ${signal}`);
        if (!spawned) {
          if (code !== 0) {
            reject(new Error(`Codex Code exited with code ${code}. Output: ${output}, Error: ${errorOutput}`));
          } else {
            reject(new Error(`Codex Code process exited unexpectedly`));
          }
        }
      });

      const timeout = setTimeout(() => {
        if (!spawned) {
          codexProcess.kill('SIGTERM');
          reject(new Error(`Codex Code process failed to start within timeout. Output: ${output}, Error: ${errorOutput}`));
        }
      }, 10000);

      codexProcess.on('spawn', () => {
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
      console.log(`Starting Codex Code PTY in directory: ${worktree.path}`);
      
      const codexPty = spawnPty('codex', [], {
        cwd: worktree.path,
        cols: 80,
        rows: 30,
        env: {
          ...process.env,
          CODEX_CODE_PORT: instance.port?.toString(),
          PATH: process.env.PATH
        } as { [key: string]: string }
      });

      let spawned = false;
      let output = '';

      codexPty.onData((data: string) => {
        const MAX_OUTPUT_LENGTH = 10000;
        output += data;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }

        if (data.length < 100 && (data.includes('Codex') || data.includes('error') || data.includes('Error'))) {
          console.log(`Codex PTY ${instance.id} output:`, data.substring(0, 200));
        }

        if (!spawned && (data.includes('Codex') || data.includes('codex') || output.length > 100)) {
          spawned = true;
          console.log(`Codex Code PTY ready for worktree ${worktree.path} with PID ${codexPty.pid}`);
          resolve(codexPty);
        }
      });

      codexPty.onExit(() => {
        console.log(`Codex PTY process exited`);
        if (!spawned) {
          reject(new Error(`Codex Code PTY process exited unexpectedly. Output: ${output}`));
        }
      });

      const timeout = setTimeout(() => {
        if (!spawned) {
          codexPty.kill();
          reject(new Error(`Codex Code PTY failed to start within timeout. Output: ${output}`));
        }
      }, 10000);

      setTimeout(() => {
        if (!spawned) {
          spawned = true;
          clearTimeout(timeout);
          console.log(`Codex Code PTY assumed ready for worktree ${worktree.path}`);
          resolve(codexPty);
        }
      }, 3000);
    });
  }

  async executeCommand(prompt: string, workingDirectory: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const codexProcess = spawn('codex', [prompt], {
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
        codexProcess.kill('SIGTERM');
        reject(new Error('Codex command timed out'));
      }, 30000);

      codexProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      codexProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      codexProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Codex command failed with code ${code}: ${errorOutput}`));
        }
      });

      codexProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      codexProcess.stdin.write(`"${prompt}"`);
      codexProcess.stdin.end();
    });
  }

  parseUsageOutput(output: string): { input?: number; output?: number; cost?: number } | null {
    // Codex may not have the same usage tracking format as Claude
    // This is a placeholder - would need to be implemented based on actual Codex CLI output format
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && (trimmed.includes('usage') || trimmed.includes('tokens'))) {
          const json = JSON.parse(trimmed);

          // Adjust based on actual Codex output format
          if (json.usage && (json.usage.prompt_tokens || json.usage.completion_tokens)) {
            const inputTokens = json.usage.prompt_tokens || 0;
            const outputTokens = json.usage.completion_tokens || 0;

            return {
              input: inputTokens,
              output: outputTokens,
              cost: this.calculateCost(inputTokens, outputTokens)
            };
          }
        }
      }
    } catch (error) {
      console.log(`Failed to parse Codex usage output:`, error);
    }
    return null;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Placeholder pricing for Codex - would need to be updated with actual pricing
    // OpenAI Codex pricing varies by model, this is a generic estimate
    const inputCost = (inputTokens / 1000000) * 2.00;  // $2 per 1M input tokens
    const outputCost = (outputTokens / 1000000) * 10.00; // $10 per 1M output tokens

    return inputCost + outputCost;
  }
}