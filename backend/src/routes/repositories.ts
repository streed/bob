import { Router } from 'express';
import { GitService } from '../services/git.js';
import { LLMService } from '../services/llm-service.js';
import { CreateWorktreeRequest } from '../types.js';

export function createRepositoryRoutes(gitService: GitService, llmService: LLMService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const repositories = gitService.getRepositories();
      res.json(repositories);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get repositories' });
    }
  });

  router.post('/add', async (req, res) => {
    try {
      const { repositoryPath } = req.body;
      if (!repositoryPath) {
        return res.status(400).json({ error: 'repositoryPath is required' });
      }

      const repository = await gitService.addRepository(repositoryPath);
      res.status(201).json(repository);
    } catch (error) {
      res.status(500).json({ error: `Failed to add repository: ${error}` });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const repository = gitService.getRepository(req.params.id);
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      res.json(repository);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get repository' });
    }
  });

  router.get('/:id/worktrees', (req, res) => {
    try {
      const worktrees = gitService.getWorktreesByRepository(req.params.id);
      res.json(worktrees);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get worktrees' });
    }
  });

  router.post('/:id/worktrees', async (req, res) => {
    try {
      const { branchName, baseBranch } = req.body as CreateWorktreeRequest;
      
      if (!branchName) {
        return res.status(400).json({ error: 'branchName is required' });
      }

      const worktree = await gitService.createWorktree(req.params.id, branchName, baseBranch);
      res.status(201).json(worktree);
    } catch (error) {
      res.status(500).json({ error: `Failed to create worktree: ${error}` });
    }
  });

  router.get('/worktrees/:worktreeId/merge-status', async (req, res) => {
    try {
      const mergeStatus = await gitService.checkBranchMergeStatus(req.params.worktreeId);
      res.json(mergeStatus);
    } catch (error) {
      res.status(500).json({ error: `Failed to check merge status: ${error}` });
    }
  });

  router.delete('/worktrees/:worktreeId', async (req, res) => {
    try {
      const force = req.query.force === 'true';
      const worktreeId = req.params.worktreeId;
      
      // If force delete, stop all instances first
      if (force) {
        const instances = llmService.getInstancesByWorktree(worktreeId);
        for (const instance of instances) {
          if (instance.status === 'running' || instance.status === 'starting') {
            console.log(`Force delete: stopping instance ${instance.id} for worktree ${worktreeId}`);
            await llmService.stopInstance(instance.id);
          }
        }
        
        // Wait a moment for instances to fully stop and update worktree instances status
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Refresh the worktree to get updated instance statuses
        const worktree = gitService.getWorktree(worktreeId);
        if (worktree) {
          // Update instances from llm service
          const updatedInstances = llmService.getInstancesByWorktree(worktreeId);
          worktree.instances = updatedInstances;
        }
      }
      
      await gitService.removeWorktree(worktreeId, force);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: `Failed to remove worktree: ${error}` });
    }
  });

  return router;
}