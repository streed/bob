import express from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'os';

const router = express.Router();
const execAsync = promisify(exec);

// Helper function to call Claude CLI safely with file input
async function callClaude(prompt: string, input: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use spawn to avoid shell interpretation issues
    const claudeProcess = spawn('claude', [prompt], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    // Set up timeout
    const timeout = setTimeout(() => {
      claudeProcess.kill('SIGTERM');
      reject(new Error('Claude CLI timeout after 2 minutes'));
    }, 120000); // 2 minutes

    claudeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claudeProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claudeProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude CLI exited with code ${code}. stderr: ${stderr}`));
      }
    });

    claudeProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
    });

    // Send input to stdin and close it
    claudeProcess.stdin.write(input);
    claudeProcess.stdin.end();
  });
}

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

// Generate AI commit message with optional comments context
router.post('/:worktreeId/generate-commit-message', async (req, res) => {
  const { comments } = req.body || {};
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
      // Prepare diff with comments context if available
      let diffWithComments = diff;
      if (comments && comments.length > 0) {
        diffWithComments += '\n\n=== CODE REVIEW COMMENTS ===\n';
        const commentsByFile = comments.reduce((acc, comment) => {
          if (!acc[comment.file]) acc[comment.file] = [];
          acc[comment.file].push(comment);
          return acc;
        }, {});

        Object.entries(commentsByFile).forEach(([file, fileComments]) => {
          diffWithComments += `\nFile: ${file}\n`;
          fileComments.forEach(comment => {
            diffWithComments += `Line ${comment.line} (${comment.type}${comment.isAI ? ' - AI Generated' : ' - User'}): ${comment.message}\n`;
            if (comment.userReply) {
              diffWithComments += `  User Reply: ${comment.userReply}\n`;
            }
          });
        });
      }

      // Step 1: Generate detailed commit body first
      const bodyPrompt = `Analyze this git diff and generate a detailed commit message body that explains what changed and why. The body should:
1. Explain the purpose of the changes
2. List the key modifications made
3. Mention any important technical details
4. Be 3-5 sentences that provide comprehensive context
${comments && comments.length > 0 ? '5. Consider the code review comments provided to understand context and improvements made' : ''}

Only return the body content, no subject line. Focus on the actual code changes, not just file counts.`;

      const commitBody = await callClaude(bodyPrompt, diffWithComments, worktree.path);

      // Step 2: Generate concise subject from the body
      const subjectPrompt = `Based on this commit body, generate a concise subject line following conventional commit format (type: description). Subject should be under 72 characters. Types: feat, fix, docs, style, refactor, test, chore. Only return the subject line.`;

      const commitSubject = await callClaude(subjectPrompt, commitBody, worktree.path);

      // Combine subject and body
      const aiCommitMessage = `${commitSubject}\n\n${commitBody}`;

      res.json({
        commitMessage: aiCommitMessage,
        commitSubject: commitSubject,
        commitBody: commitBody,
        changedFiles: changedFiles.split('\n').filter(f => f.trim()),
        fileCount: changedFiles.split('\n').filter(f => f.trim()).length
      });
    } catch (claudeError) {
      console.error('Error calling Claude:', claudeError);

      // Fallback to simple commit message
      const files = status.split('\n').filter(line => line.trim()).length;
      const fallbackSubject = `Update ${files} file${files !== 1 ? 's' : ''}`;
      const fallbackBody = `Updated files: ${changedFiles.split('\n').filter(f => f.trim()).join(', ')}`;
      const fallbackMessage = `${fallbackSubject}\n\n${fallbackBody}`;

      res.json({
        commitMessage: fallbackMessage,
        commitSubject: fallbackSubject,
        commitBody: fallbackBody,
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

    // Get comprehensive diff for PR description
    const { stdout: diff } = await execAsync('git diff main...HEAD', {
      cwd: worktree.path
    });

    // Get commit history for PR summary
    const { stdout: commits } = await execAsync('git log main..HEAD --pretty=format:"%h %s"', {
      cwd: worktree.path
    });

    // Generate comprehensive PR title and description using Claude CLI
    let prTitle = branchName.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    let prDescription = `## Summary\n\nChanges in this pull request:\n\n${commits}\n\n🤖 Generated with Claude Code`;

    try {
      // Generate PR title
      const titlePrompt = `Based on this git diff and commit history, generate a concise PR title that follows conventional commit format. Keep it under 72 characters. Types: feat, fix, docs, style, refactor, test, chore. Only return the title.`;

      const diffAndCommits = `${diff}\n\nCommits:\n${commits}`;
      const claudeTitleOutput = await callClaude(titlePrompt, diffAndCommits, worktree.path);

      if (claudeTitleOutput) {
        prTitle = claudeTitleOutput;
      }

      // Generate PR description
      const descPrompt = `Based on this git diff and commit history, generate a comprehensive PR description with:
1. ## Summary - What this PR does
2. ## Changes Made - Key modifications
3. ## Testing - How to test these changes
4. Use markdown formatting. Be detailed but concise.`;

      const claudeDescOutput = await callClaude(descPrompt, diffAndCommits, worktree.path);

      if (claudeDescOutput) {
        prDescription = `${claudeDescOutput}\n\n🤖 Generated with Claude Code`;
      }
    } catch (claudeError) {
      console.warn('Failed to generate PR content with Claude, using fallback:', claudeError);
    }

    // Try to create PR using GitHub CLI
    try {
      const { stdout: prResult } = await execAsync(`gh pr create --title "${prTitle}" --body "${prDescription.replace(/"/g, '\\"')}" --base main`, {
        cwd: worktree.path
      });

      res.json({
        message: 'Pull request created successfully',
        branch: branchName,
        title: prTitle,
        description: prDescription,
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

// Update pull request title and description
router.post('/:worktreeId/update-pr', async (req, res) => {
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

    // Check if PR exists for this branch
    let prNumber;
    try {
      const { stdout: prInfo } = await execAsync(`gh pr list --head ${branchName} --json number`, {
        cwd: worktree.path
      });

      const prs = JSON.parse(prInfo);
      if (prs.length === 0) {
        return res.status(404).json({ error: 'No pull request found for this branch' });
      }

      prNumber = prs[0].number;
    } catch (listError) {
      return res.status(404).json({ error: 'Failed to find pull request for branch' });
    }

    // Get comprehensive diff for PR description
    const { stdout: diff } = await execAsync('git diff main...HEAD', {
      cwd: worktree.path
    });

    // Get commit history for PR summary
    const { stdout: commits } = await execAsync('git log main..HEAD --pretty=format:"%h %s"', {
      cwd: worktree.path
    });

    // Generate comprehensive PR title and description using Claude CLI
    let prTitle = branchName.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    let prDescription = `## Summary\n\nChanges in this pull request:\n\n${commits}\n\n🤖 Generated with Claude Code`;

    try {
      // Generate PR title
      const titlePrompt = `Based on this git diff and commit history, generate a concise PR title that follows conventional commit format. Keep it under 72 characters. Types: feat, fix, docs, style, refactor, test, chore. Only return the title.`;

      const diffAndCommits = `${diff}\n\nCommits:\n${commits}`;
      const claudeTitleOutput = await callClaude(titlePrompt, diffAndCommits, worktree.path);

      if (claudeTitleOutput) {
        prTitle = claudeTitleOutput;
      }

      // Generate PR description
      const descPrompt = `Based on this git diff and commit history, generate a comprehensive PR description with:
1. ## Summary - What this PR does
2. ## Changes Made - Key modifications
3. ## Testing - How to test these changes
4. Use markdown formatting. Be detailed but concise.`;

      const claudeDescOutput = await callClaude(descPrompt, diffAndCommits, worktree.path);

      if (claudeDescOutput) {
        prDescription = `${claudeDescOutput}\n\n🤖 Generated with Claude Code`;
      }
    } catch (claudeError) {
      console.warn('Failed to generate PR content with Claude, using fallback:', claudeError);
    }

    // Update PR title and description using GitHub CLI
    try {
      await execAsync(`gh pr edit ${prNumber} --title "${prTitle}" --body "${prDescription.replace(/"/g, '\\"')}"`, {
        cwd: worktree.path
      });

      res.json({
        message: 'Pull request updated successfully',
        prNumber: prNumber,
        title: prTitle,
        description: prDescription
      });
    } catch (updateError) {
      console.error('Failed to update PR:', updateError);
      res.status(500).json({ error: 'Failed to update pull request' });
    }
  } catch (error) {
    console.error('Error updating PR:', error);
    res.status(500).json({ error: 'Failed to update pull request' });
  }
});

// Analyze git diff and generate inline comments
router.post('/:worktreeId/analyze-diff', async (req, res) => {
  try {
    const { worktreeId } = req.params;

    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get comprehensive diff
    const { stdout: diff } = await execAsync('git diff HEAD', {
      cwd: worktree.path
    });

    // Get untracked files and add to diff
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: worktree.path
    });

    let completeDiff = diff;

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

    if (!completeDiff.trim()) {
      return res.status(400).json({ error: 'No changes to analyze' });
    }

    try {
      // Generate analysis with Claude
      const analysisPrompt = `Analyze this git diff and provide inline comments for code review.
Focus on:
1. Code quality improvements
2. Best practices
3. Potential bugs or issues
4. Performance considerations
5. Security concerns

Return a JSON object with this structure:
{
  "comments": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "type": "suggestion|warning|error",
      "message": "Your comment here",
      "severity": "low|medium|high"
    }
  ],
  "summary": "Overall analysis summary"
}

Only include substantive comments that add value. Be concise but helpful.`;

      const analysisResult = await callClaude(analysisPrompt, completeDiff, worktree.path);

      let parsedResult;
      try {
        // Extract JSON from Claude's response (it might be embedded in text)
        let jsonString = analysisResult.trim();

        // Look for JSON block in the response
        const jsonStart = jsonString.indexOf('```json\n');
        const jsonEnd = jsonString.lastIndexOf('\n```');

        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonString = jsonString.substring(jsonStart + 8, jsonEnd);
        } else {
          // Look for plain JSON block
          const plainJsonStart = jsonString.indexOf('{');
          const plainJsonEnd = jsonString.lastIndexOf('}');
          if (plainJsonStart !== -1 && plainJsonEnd !== -1) {
            jsonString = jsonString.substring(plainJsonStart, plainJsonEnd + 1);
          }
        }

        parsedResult = JSON.parse(jsonString.trim());
      } catch (parseError) {
        // Fallback if Claude doesn't return valid JSON
        parsedResult = {
          comments: [],
          summary: analysisResult.trim() || 'Analysis completed but no structured feedback generated.'
        };
      }

      // Save analysis to database
      const { stdout: gitHash } = await execAsync('git rev-parse HEAD', {
        cwd: worktree.path
      });

      const databaseService = req.app.locals.databaseService;
      const analysisId = `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Save analysis
      await databaseService.run(
        'INSERT OR REPLACE INTO git_analysis (id, worktree_id, git_hash, analysis_summary) VALUES (?, ?, ?, ?)',
        [analysisId, worktreeId, gitHash.trim(), parsedResult.summary]
      );

      // Save comments
      for (const comment of parsedResult.comments || []) {
        const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await databaseService.run(
          'INSERT INTO diff_comments (id, analysis_id, worktree_id, file_path, line_number, comment_type, message, severity, is_ai_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [commentId, analysisId, worktreeId, comment.file, comment.line, comment.type, comment.message, comment.severity, true]
        );
      }

      res.json({
        analysis: {
          ...parsedResult,
          analysisId
        },
        diffAnalyzed: completeDiff.length > 0
      });
    } catch (claudeError) {
      console.error('Error calling Claude for analysis:', claudeError);
      res.status(500).json({ error: 'Failed to analyze diff with Claude' });
    }
  } catch (error) {
    console.error('Error analyzing git diff:', error);
    res.status(500).json({ error: 'Failed to analyze git diff' });
  }
});

// Get analysis and comments for a worktree
router.get('/:worktreeId/analysis', async (req, res) => {
  try {
    const { worktreeId } = req.params;
    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get current git hash
    const { stdout: gitHash } = await execAsync('git rev-parse HEAD', {
      cwd: worktree.path
    });

    const databaseService = req.app.locals.databaseService;

    // Get analysis for current git state
    const analysis = await databaseService.get(
      'SELECT * FROM git_analysis WHERE worktree_id = ? AND git_hash = ? ORDER BY analysis_timestamp DESC LIMIT 1',
      [worktreeId, gitHash.trim()]
    );

    if (!analysis) {
      return res.json({ analysis: null, comments: [] });
    }

    // Get comments for this analysis
    const comments = await databaseService.all(
      'SELECT * FROM diff_comments WHERE analysis_id = ? AND is_dismissed = 0 ORDER BY file_path, line_number',
      [analysis.id]
    );

    res.json({
      analysis: {
        id: analysis.id,
        summary: analysis.analysis_summary,
        timestamp: analysis.analysis_timestamp
      },
      comments: comments.map((comment: any) => ({
        id: comment.id,
        file: comment.file_path,
        line: comment.line_number,
        type: comment.comment_type,
        message: comment.message,
        severity: comment.severity,
        isAI: comment.is_ai_generated,
        userReply: comment.user_reply
      }))
    });
  } catch (error) {
    console.error('Error getting analysis:', error);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
});

// Save analysis and comments to database
router.post('/:worktreeId/save-analysis', async (req, res) => {
  try {
    const { worktreeId } = req.params;
    const { analysis, comments } = req.body;

    const gitService = req.app.locals.gitService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get current git hash
    const { stdout: gitHash } = await execAsync('git rev-parse HEAD', {
      cwd: worktree.path
    });

    const databaseService = req.app.locals.databaseService;
    const analysisId = `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Save analysis
    await databaseService.run(
      'INSERT OR REPLACE INTO git_analysis (id, worktree_id, git_hash, analysis_summary) VALUES (?, ?, ?, ?)',
      [analysisId, worktreeId, gitHash.trim(), analysis.summary]
    );

    // Save comments
    for (const comment of comments) {
      const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await databaseService.run(
        'INSERT INTO diff_comments (id, analysis_id, worktree_id, file_path, line_number, comment_type, message, severity, is_ai_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [commentId, analysisId, worktreeId, comment.file, comment.line, comment.type, comment.message, comment.severity, comment.isAI || false]
      );
    }

    res.json({ success: true, analysisId });
  } catch (error) {
    console.error('Error saving analysis:', error);
    res.status(500).json({ error: 'Failed to save analysis' });
  }
});

// Add a user comment
router.post('/:worktreeId/comments', async (req, res) => {
  try {
    const { worktreeId } = req.params;
    const { analysisId, file, line, message } = req.body;

    const databaseService = req.app.locals.databaseService;
    const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    await new Promise((resolve, reject) => {
      databaseService.run(
        'INSERT INTO diff_comments (id, analysis_id, worktree_id, file_path, line_number, comment_type, message, severity, is_ai_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [commentId, analysisId, worktreeId, file, line, 'user', message, 'low', false],
        function(err: any) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });

    res.json({
      id: commentId,
      file,
      line,
      type: 'user',
      message,
      severity: 'low',
      isAI: false
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Update a comment (add reply or dismiss)
router.put('/:worktreeId/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { userReply, isDismissed } = req.body;

    const databaseService = req.app.locals.databaseService;

    let query = '';
    let params: any[] = [];

    if (userReply !== undefined) {
      query = 'UPDATE diff_comments SET user_reply = ? WHERE id = ?';
      params = [userReply, commentId];
    } else if (isDismissed !== undefined) {
      query = 'UPDATE diff_comments SET is_dismissed = ? WHERE id = ?';
      params = [isDismissed ? 1 : 0, commentId];
    } else {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }

    await databaseService.run(query, params);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Apply code fixes based on non-dismissed comments
router.post('/:worktreeId/apply-fixes', async (req, res) => {
  try {
    const { worktreeId } = req.params;

    const gitService = req.app.locals.gitService;
    const databaseService = req.app.locals.databaseService;
    const worktree = gitService.getWorktree(worktreeId);

    if (!worktree) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    // Get current git hash
    const { stdout: gitHash } = await execAsync('git rev-parse HEAD', {
      cwd: worktree.path
    });

    // Get current git diff
    const { stdout: gitDiff } = await execAsync('git diff', {
      cwd: worktree.path
    });

    if (!gitDiff.trim()) {
      return res.status(400).json({ error: 'No changes to fix' });
    }

    // Get latest analysis for current git state
    const analysis = await databaseService.get(
      'SELECT * FROM git_analysis WHERE worktree_id = ? AND git_hash = ? ORDER BY analysis_timestamp DESC LIMIT 1',
      [worktreeId, gitHash.trim()]
    );

    if (!analysis) {
      return res.status(404).json({ error: 'No analysis found for current git state. Please run analysis first.' });
    }

    // Get non-dismissed comments with user replies
    const comments = await databaseService.all(
      'SELECT * FROM diff_comments WHERE analysis_id = ? AND is_dismissed = 0 ORDER BY file_path, line_number',
      [analysis.id]
    );

    if (comments.length === 0) {
      return res.status(400).json({ error: 'No active comments to apply fixes for' });
    }

    // Group comments by file
    const commentsByFile = comments.reduce((acc, comment) => {
      if (!acc[comment.file_path]) {
        acc[comment.file_path] = [];
      }
      acc[comment.file_path].push({
        line: comment.line_number,
        type: comment.comment_type,
        message: comment.message,
        severity: comment.severity,
        userReply: comment.user_reply,
        isAI: comment.is_ai_generated
      });
      return acc;
    }, {});

    // Apply fixes file by file to avoid patch corruption issues
    let totalFixesApplied = 0;
    const modifiedFiles = [];

    for (const [filePath, fileComments] of Object.entries(commentsByFile)) {
      try {
        // Read the current file content
        const fullFilePath = path.join(worktree.path, filePath);
        const originalContent = await fs.promises.readFile(fullFilePath, 'utf8');

        // Create prompt for this specific file
        const fileFixPrompt = `You are a code improvement assistant. Apply the requested fixes to this file based on the provided comments and user feedback.

IMPORTANT INSTRUCTIONS:
1. Only modify the lines that have specific comments and feedback
2. Apply the suggestions from comments, especially considering any user replies
3. If a user reply disagrees with an AI comment, prioritize the user's feedback
4. Be conservative - only make changes that are clearly requested
5. Return the complete modified file content
6. Maintain all existing code structure and formatting

File: ${filePath}

Comments to address:
${fileComments.map(c =>
  `Line ${c.line}: [${c.type}] ${c.message}${c.userReply ? `\n  User feedback: ${c.userReply}` : ''}`
).join('\n')}

Return only the complete file content with the requested improvements applied.`;

        console.log(`Applying fixes to ${filePath}...`);
        const fixedContent = await callClaude(fileFixPrompt, originalContent, worktree.path);

        // Only apply changes if the content actually changed
        if (fixedContent && fixedContent.trim() !== originalContent.trim()) {
          await fs.promises.writeFile(fullFilePath, fixedContent, 'utf8');
          totalFixesApplied += fileComments.length;
          modifiedFiles.push(filePath);
          console.log(`Successfully applied fixes to ${filePath}`);
        } else {
          console.log(`No changes needed for ${filePath}`);
        }

      } catch (fileError) {
        console.error(`Error processing ${filePath}:`, fileError);
        // Continue with other files even if one fails
      }
    }

    if (totalFixesApplied > 0) {
      res.json({
        success: true,
        message: `Code fixes applied successfully to ${modifiedFiles.length} file(s)`,
        fixesApplied: totalFixesApplied,
        filesModified: modifiedFiles.length,
        modifiedFiles
      });
    } else {
      res.json({
        success: true,
        message: 'No changes needed - code is already optimal',
        fixesApplied: 0
      });
    }

  } catch (error) {
    console.error('Error applying fixes:', error);
    res.status(500).json({ error: 'Failed to apply code fixes' });
  }
});

export default router;