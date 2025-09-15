import { spawn, IPty } from 'node-pty';
import { WebSocket } from 'ws';
import { ChildProcess } from 'child_process';

export interface TerminalSession {
  id: string;
  instanceId: string;
  pty?: IPty;
  claudeProcess?: ChildProcess;
  claudePty?: IPty;
  websocket?: WebSocket;
  createdAt: Date;
}

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  createSession(instanceId: string, cwd: string): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const pty = spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd,
      env: process.env as { [key: string]: string }
    });

    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      pty,
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);

    pty.onExit(() => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  createClaudeSession(instanceId: string, claudeProcess: ChildProcess): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      claudeProcess,
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);

    claudeProcess.on('exit', () => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  createClaudePtySession(instanceId: string, claudePty: IPty): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      claudePty,
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);

    claudePty.onExit(() => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  attachWebSocket(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.close(1000, 'Session not found');
      return;
    }

    session.websocket = ws;

    if (session.pty) {
      // Handle PTY-based session (bash terminal)
      session.pty.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });

      ws.on('message', (message: string) => {
        try {
          const msg = JSON.parse(message);
          
          switch (msg.type) {
            case 'data':
              session.pty!.write(msg.data);
              break;
            case 'resize':
              // Validate resize dimensions are positive integers
              if (msg.cols && msg.rows &&
                  Number.isInteger(msg.cols) && Number.isInteger(msg.rows) &&
                  msg.cols > 0 && msg.rows > 0) {
                session.pty!.resize(msg.cols, msg.rows);
              } else {
                console.warn(`Invalid resize dimensions: cols=${msg.cols}, rows=${msg.rows}`);
              }
              break;
          }
        } catch (error) {
          console.error('Error processing terminal message:', error);
        }
      });
    } else if (session.claudeProcess) {
      // Handle Claude process session
      session.claudeProcess.stdout?.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data: data.toString() }));
        }
      });

      session.claudeProcess.stderr?.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data: data.toString() }));
        }
      });

      ws.on('message', (message: string) => {
        try {
          const msg = JSON.parse(message);
          
          switch (msg.type) {
            case 'data':
              if (session.claudeProcess?.stdin?.writable) {
                session.claudeProcess.stdin.write(msg.data);
              }
              break;
            // Claude processes don't support resize
          }
        } catch (error) {
          console.error('Error processing terminal message:', error);
        }
      });
    } else if (session.claudePty) {
      // Handle Claude PTY session (interactive Claude terminal)
      session.claudePty.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });

      ws.on('message', (message: string) => {
        try {
          const msg = JSON.parse(message);
          
          switch (msg.type) {
            case 'data':
              session.claudePty!.write(msg.data);
              break;
            case 'resize':
              // Validate resize dimensions are positive integers
              if (msg.cols && msg.rows &&
                  Number.isInteger(msg.cols) && Number.isInteger(msg.rows) &&
                  msg.cols > 0 && msg.rows > 0) {
                session.claudePty!.resize(msg.cols, msg.rows);
              } else {
                console.warn(`Invalid resize dimensions: cols=${msg.cols}, rows=${msg.rows}`);
              }
              break;
          }
        } catch (error) {
          console.error('Error processing terminal message:', error);
        }
      });
    }

    ws.on('close', () => {
      session.websocket = undefined;
    });

    ws.send(JSON.stringify({ type: 'ready' }));
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  getSessionsByInstance(instanceId: string): TerminalSession[] {
    return Array.from(this.sessions.values()).filter(s => s.instanceId === instanceId);
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      if (session.pty) {
        session.pty.kill();
      }
      // Don't kill the Claude process - it should continue running
      this.sessions.delete(id);
      if (session.websocket) {
        session.websocket.close();
      }
    }
  }

  cleanup(): void {
    for (const session of this.sessions.values()) {
      this.closeSession(session.id);
    }
  }
}