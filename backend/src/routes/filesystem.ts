import { Router } from 'express';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export function createFilesystemRoutes(): Router {
  const router = Router();

  router.get('/browse', async (req, res) => {
    try {
      const { path = '/' } = req.query;
      const dirPath = path as string;

      if (!existsSync(dirPath)) {
        return res.status(404).json({ error: 'Directory not found' });
      }

      const entries = await readdir(dirPath);
      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(dirPath, entry);
          try {
            const stats = await stat(fullPath);
            return {
              name: entry,
              path: fullPath,
              isDirectory: stats.isDirectory(),
              isGitRepo: stats.isDirectory() && existsSync(join(fullPath, '.git'))
            };
          } catch (error) {
            return null;
          }
        })
      );

      const validItems = items
        .filter(item => item !== null)
        .filter(item => item.isDirectory) // Only return directories
        .sort((a, b) => {
          // Git repos first, then alphabetical
          if (a.isGitRepo && !b.isGitRepo) return -1;
          if (!a.isGitRepo && b.isGitRepo) return 1;
          return a.name.localeCompare(b.name);
        });

      res.json({
        currentPath: dirPath,
        parent: dirPath !== '/' ? join(dirPath, '..') : null,
        items: validItems
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to browse directory' });
    }
  });

  return router;
}