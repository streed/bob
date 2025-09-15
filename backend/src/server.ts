import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { GitService } from './services/git.js';
import { ClaudeService } from './services/claude.js';
import { TerminalService } from './services/terminal.js';
import { WorktreeStateService } from './services/worktree-state.js';
import { DatabaseService } from './database/database.js';
import { createRepositoryRoutes } from './routes/repositories.js';
import { createInstanceRoutes } from './routes/instances.js';
import { createFilesystemRoutes } from './routes/filesystem.js';
import gitRoutes from './routes/git.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 43829;

app.use(cors());
app.use(express.json());

// Initialize database
const db = new DatabaseService();
console.log('Database initialized');

// Initialize services
const gitService = new GitService(db);
const claudeService = new ClaudeService(gitService, db);
const terminalService = new TerminalService();
const worktreeStateService = new WorktreeStateService(gitService, claudeService);

console.log('Services initialized');

// Start the worktree state monitoring service
worktreeStateService.start();

app.use('/api/repositories', createRepositoryRoutes(gitService, claudeService));
app.use('/api/instances', createInstanceRoutes(claudeService, terminalService, gitService));
app.use('/api/filesystem', createFilesystemRoutes());

// Make services available to git routes
app.locals.gitService = gitService;
app.locals.claudeService = claudeService;
app.locals.databaseService = db;
app.use('/api/git', gitRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/system-status', async (req, res) => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Check Claude CLI availability
    let claudeStatus = 'unknown';
    let claudeVersion = '';
    try {
      const { stdout } = await execAsync('claude --version');
      claudeVersion = stdout.trim();
      claudeStatus = 'available';
    } catch (error) {
      claudeStatus = 'not_available';
    }

    // Check GitHub CLI availability
    let githubStatus = 'unknown';
    let githubVersion = '';
    let githubUser = '';
    try {
      const { stdout: versionOut } = await execAsync('gh --version');
      githubVersion = versionOut.split('\n')[0]?.trim() || '';
      githubStatus = 'available';

      try {
        const { stdout: userOut } = await execAsync('gh api user --jq .login');
        githubUser = userOut.trim();
      } catch (userError) {
        githubStatus = 'not_authenticated';
      }
    } catch (error) {
      githubStatus = 'not_available';
    }

    // Get system metrics
    const gitService = req.app.locals.gitService;
    const claudeService = req.app.locals.claudeService;

    const repositories = gitService.getRepositories();
    const totalWorktrees = repositories.reduce((count: number, repo: any) => count + repo.worktrees.length, 0);
    const instances = claudeService.getInstances();
    const activeInstances = instances.filter((i: any) => i.status === 'running' || i.status === 'starting').length;

    res.json({
      claude: {
        status: claudeStatus,
        version: claudeVersion
      },
      github: {
        status: githubStatus,
        version: githubVersion,
        user: githubUser
      },
      metrics: {
        repositories: repositories.length,
        worktrees: totalWorktrees,
        totalInstances: instances.length,
        activeInstances: activeInstances
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      }
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

// Serve static files from frontend build (only in production)
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));

  // Serve index.html for all non-API routes (SPA routing)
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  // In development, just show a message for non-API routes
  app.get('*', (req, res) => {
    res.json({
      message: 'Bob backend running in development mode',
      frontend: 'http://localhost:47285',
      api: `http://localhost:${PORT}/api`
    });
  });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    ws.close(1000, 'Session ID required');
    return;
  }

  console.log(`WebSocket connection for terminal session: ${sessionId}`);
  terminalService.attachWebSocket(sessionId, ws);
});

const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  
  worktreeStateService.stop();
  await claudeService.cleanup();
  terminalService.cleanup();
  db.close();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

server.listen(PORT, () => {
  console.log(`Bob server running on port ${PORT}`);
  console.log(`WebSocket server ready for terminal connections`);
});

export { app, server };