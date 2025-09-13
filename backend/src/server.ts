import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { GitService } from './services/git.js';
import { ClaudeService } from './services/claude.js';
import { TerminalService } from './services/terminal.js';
import { DatabaseService } from './database/database.js';
import { createRepositoryRoutes } from './routes/repositories.js';
import { createInstanceRoutes } from './routes/instances.js';
import { createFilesystemRoutes } from './routes/filesystem.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize database
const db = new DatabaseService();
console.log('Database initialized');

// Initialize services
const gitService = new GitService(db);
const claudeService = new ClaudeService(gitService, db);
const terminalService = new TerminalService();

console.log('Services initialized');

app.use('/api/repositories', createRepositoryRoutes(gitService, claudeService));
app.use('/api/instances', createInstanceRoutes(claudeService, terminalService, gitService));
app.use('/api/filesystem', createFilesystemRoutes());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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