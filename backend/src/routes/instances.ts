import { Router } from 'express';
import { ClaudeService } from '../services/claude.js';
import { TerminalService } from '../services/terminal.js';
import { GitService } from '../services/git.js';
import { StartInstanceRequest } from '../types.js';

export function createInstanceRoutes(
  claudeService: ClaudeService, 
  terminalService: TerminalService,
  gitService: GitService
): Router {
  const router = Router();

  router.get('/', (req, res) => {
    try {
      const instances = claudeService.getInstances();
      res.json(instances);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get instances' });
    }
  });

  router.get('/repository/:repositoryId', (req, res) => {
    try {
      const instances = claudeService.getInstancesByRepository(req.params.repositoryId);
      res.json(instances);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get instances for repository' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { worktreeId } = req.body as StartInstanceRequest;
      
      if (!worktreeId) {
        return res.status(400).json({ error: 'worktreeId is required' });
      }

      const instance = await claudeService.startInstance(worktreeId);
      res.status(201).json(instance);
    } catch (error) {
      res.status(500).json({ error: `Failed to start instance: ${error}` });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const instance = claudeService.getInstance(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      res.json(instance);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get instance' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await claudeService.stopInstance(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: `Failed to stop instance: ${error}` });
    }
  });

  router.post('/:id/restart', async (req, res) => {
    try {
      const instance = await claudeService.restartInstance(req.params.id);
      res.json(instance);
    } catch (error) {
      res.status(500).json({ error: `Failed to restart instance: ${error}` });
    }
  });

  router.post('/:id/terminal', (req, res) => {
    try {
      const instance = claudeService.getInstance(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      if (instance.status !== 'running') {
        return res.status(400).json({ 
          error: `Cannot connect to Claude terminal. Instance is ${instance.status}. Please start the instance first.` 
        });
      }

      const claudePty = claudeService.getClaudePty(req.params.id);
      if (!claudePty) {
        return res.status(404).json({ 
          error: 'Claude terminal not available. The Claude process may have stopped unexpectedly.' 
        });
      }

      const session = terminalService.createClaudePtySession(req.params.id, claudePty);
      res.json({ sessionId: session.id });
    } catch (error) {
      res.status(500).json({ error: `Failed to create terminal session: ${error}` });
    }
  });

  router.post('/:id/terminal/directory', (req, res) => {
    try {
      const instance = claudeService.getInstance(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      const worktree = gitService.getWorktree(instance.worktreeId);
      if (!worktree) {
        return res.status(404).json({ error: 'Worktree not found' });
      }

      const session = terminalService.createSession(req.params.id, worktree.path);
      res.json({ sessionId: session.id });
    } catch (error) {
      res.status(500).json({ error: `Failed to create directory terminal session: ${error}` });
    }
  });

  router.get('/:id/terminals', (req, res) => {
    try {
      const sessions = terminalService.getSessionsByInstance(req.params.id);
      res.json(sessions.map(s => ({ 
        id: s.id, 
        createdAt: s.createdAt,
        type: s.claudePty ? 'claude' : s.pty ? 'directory' : 'unknown'
      })));
    } catch (error) {
      res.status(500).json({ error: 'Failed to get terminal sessions' });
    }
  });

  router.delete('/terminals/:sessionId', (req, res) => {
    try {
      terminalService.closeSession(req.params.sessionId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to close terminal session' });
    }
  });

  return router;
}