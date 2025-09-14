import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const router = express.Router();
const execAsync = promisify(exec);

// Get git diff for a worktree
router.get('/:worktreeId/diff', async (req, res) => {
  try {
    const { worktreeId } = req.params;

    // Get worktree path from git service
    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get comprehensive diff including untracked files
    const { stdout: diff } = await execAsync('git diff HEAD', {
      cwd: worktree.path
    });

    // Get untracked files
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: worktree.path
    });

    let completeDiff = diff;

    // Add untracked files to the diff
    if (status.trim()) {
      const untrackedFiles = status
        .split('\n')
        .filter(line => line.startsWith('??'))
        .map(line => line.substring(3).trim());

      for (const file of untrackedFiles) {
        try {
          const { stdout: fileContent } = await execAsync(`cat "${file}"`, {
            cwd: worktree.path
          });

          completeDiff += `\ndiff --git a/${file} b/${file}\n`;
          completeDiff += `new file mode 100644\n`;
          completeDiff += `index 0000000..${Math.random().toString(36).substr(2, 7)}\n`;
          completeDiff += `--- /dev/null\n`;
          completeDiff += `+++ b/${file}\n`;
          completeDiff += `@@ -0,0 +1,${fileContent.split('\n').length} @@\n`;

          fileContent.split('\n').forEach(line => {
            if (line.trim() || fileContent.indexOf(line) !== fileContent.lastIndexOf('\n')) {
              completeDiff += `+${line}\n`;
            }
          });
        } catch (fileError) {
          console.warn(`Failed to read untracked file ${file}:`, fileError);
        }
      }
    }

    res.set('Content-Type', 'text/plain');
    res.send(completeDiff);
  } catch (error) {
    console.error('Error getting git diff:', error);
    res.status(500).json({ error: 'Failed to get git diff' });
  }
});

// Generate AI commit message
router.post('/:worktreeId/generate-commit-message', async (req, res) => {
  try {
    const { worktreeId } = req.params;

    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get git status
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: worktree.path
    });

    if (!status.trim()) {
      return res.status(400).json({ error: 'No changes to commit' });
    }

    // Get diff for commit message generation
    const { stdout: diff } = await execAsync('git diff HEAD', {
      cwd: worktree.path
    });

    // Get list of changed files
    const { stdout: changedFiles } = await execAsync('git diff --name-only HEAD', {
      cwd: worktree.path
    });

    if (!diff.trim()) {
      return res.status(400).json({ error: 'No diff available' });
    }

    try {
      // Call Claude to generate commit message
      const prompt = `Please analyze this git diff and generate a concise, descriptive commit message. Follow conventional commit format (type: description) where type is one of: feat, fix, docs, style, refactor, test, chore. The commit message should be under 72 characters for the title. If there are significant changes, provide a brief body explaining what changed and why. Format as: Title\\n\\nBody (if needed). Only return the commit message, nothing else.`;

      const { stdout: claudeOutput } = await execAsync(`echo "${diff.replace(/"/g, '\\"')}" | claude --prompt "${prompt}" --no-interactive`, {
        cwd: worktree.path,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      const aiCommitMessage = claudeOutput.trim();

      res.json({
        commitMessage: aiCommitMessage,
        changedFiles: changedFiles.split('\n').filter(f => f.trim()),
        fileCount: changedFiles.split('\n').filter(f => f.trim()).length
      });
    } catch (claudeError) {
      console.error('Error calling Claude:', claudeError);

      // Fallback to simple commit message
      const files = status.split('\n').filter(line => line.trim()).length;
      const fallbackMessage = `Update ${files} file${files !== 1 ? 's' : ''}

Updated files: ${changedFiles.split('\n').filter(f => f.trim()).join(', ')}`;

      res.json({
        commitMessage: fallbackMessage,
        changedFiles: changedFiles.split('\n').filter(f => f.trim()),
        fileCount: files,
        fallback: true
      });
    }
  } catch (error) {
    console.error('Error generating commit message:', error);
    res.status(500).json({ error: 'Failed to generate commit message' });
  }
});

// Commit changes with provided message
router.post('/:worktreeId/commit', async (req, res) => {
  try {
    const { worktreeId } = req.params;
    const { message } = req.body;

    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Commit message is required' });
    }

    // Get git status
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: worktree.path
    });

    if (!status.trim()) {
      return res.status(400).json({ error: 'No changes to commit' });
    }

    // Stage all changes
    await execAsync('git add .', {
      cwd: worktree.path
    });

    // Add Claude Code signature
    const finalMessage = `${message}

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`;

    // Commit changes
    await execAsync(`git commit -m "${finalMessage.replace(/"/g, '\\"')}"`, {
      cwd: worktree.path
    });

    res.json({
      message: 'Changes committed successfully',
      commitMessage: finalMessage
    });
  } catch (error) {
    console.error('Error committing changes:', error);
    res.status(500).json({ error: 'Failed to commit changes' });
  }
});

// Revert all changes
router.post('/:worktreeId/revert', async (req, res) => {
  try {
    const { worktreeId } = req.params;

    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Reset to HEAD (removes staged changes)
    await execAsync('git reset --hard HEAD', {
      cwd: worktree.path
    });

    // Clean untracked files
    await execAsync('git clean -fd', {
      cwd: worktree.path
    });

    res.json({ message: 'Changes reverted successfully' });
  } catch (error) {
    console.error('Error reverting changes:', error);
    res.status(500).json({ error: 'Failed to revert changes' });
  }
});

// Create pull request
router.post('/:worktreeId/create-pr', async (req, res) => {
  try {
    const { worktreeId } = req.params;

    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get current branch name
    const { stdout: currentBranch } = await execAsync('git branch --show-current', {
      cwd: worktree.path
    });

    const branchName = currentBranch.trim();

    // Push current branch to origin
    try {
      await execAsync(`git push -u origin ${branchName}`, {
        cwd: worktree.path
      });
    } catch (pushError) {
      // Branch might already exist, try regular push
      await execAsync(`git push origin ${branchName}`, {
        cwd: worktree.path
      });
    }

    // Get recent commit for PR title
    const { stdout: lastCommit } = await execAsync('git log -1 --pretty=format:"%s"', {
      cwd: worktree.path
    });

    // Try to create PR using GitHub CLI if available
    try {
      const { stdout: prResult } = await execAsync(`gh pr create --title "${lastCommit}" --body "🤖 Generated with Claude Code" --base main`, {
        cwd: worktree.path
      });

      res.json({
        message: 'Pull request created successfully',
        branch: branchName,
        title: lastCommit,
        pr: prResult.trim()
      });
    } catch (ghError) {
      // GitHub CLI not available or failed, just return push success
      res.json({
        message: 'Branch pushed successfully. Create PR manually on GitHub.',
        branch: branchName,
        title: lastCommit
      });
    }
  } catch (error) {
    console.error('Error creating PR:', error);
    res.status(500).json({ error: 'Failed to create pull request' });
  }
});

export default router;