# Bob Project - Claude Development Guide

Bob is a comprehensive development tool that manages multiple Claude Code instances across git repositories and worktrees, with integrated AI-powered code analysis and GitHub workflow automation.

## Quick Start

### Prerequisites

Before using Bob, ensure you have the following installed:

```bash
# Required Dependencies
claude --version    # Claude CLI for AI features
gh --version        # GitHub CLI for PR operations
git --version       # Git for repository management
node --version      # Node.js runtime
```

### Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Authenticate GitHub CLI** (for PR features)
   ```bash
   gh auth login
   ```

3. **Start Development Servers**
   ```bash
   npm run dev:clean  # Recommended first start
   ```

## Development Commands

### Starting Development Servers

```bash
# Clean start (recommended when switching branches)
npm run dev:clean

# Regular start (only if no conflicts exist)
npm run dev
```

### Project Structure
- `/frontend` - React/Vite frontend application (Port 5173)
- `/backend` - Node.js/Express backend application (Port 3001)
- Root package.json orchestrates both with concurrently

## Core Features

### 1. Repository & Worktree Management

**Adding Repositories:**
- Click "Add Repository" in the left panel
- Browse and select any git repository
- Bob automatically discovers existing worktrees

**Creating New Worktrees:**
- Click the "+" button next to any repository
- Enter branch name (e.g., `feature-xyz`)
- Bob creates the worktree and starts a Claude instance automatically
- Worktrees are stored in `~/.bob/` directory

**Direct Worktree Links:**
- Click the 🔗 button next to any worktree to copy a direct link
- Share links like `http://localhost:5173/?worktree=abc123` for instant access
- Perfect for team collaboration and bookmarking

### 2. Claude Code Integration

**Automatic Instance Management:**
- Each worktree gets its own isolated Claude Code instance
- Instances auto-start when selecting worktrees
- View instance status: Running, Starting, Stopped, Error
- Manual controls: Start, Stop, Restart instances

**AI-Powered Features:**
- Real-time code analysis with inline comments
- Intelligent suggestions and error detection
- Interactive comment system with replies
- Automatic code fixes based on analysis

### 3. Git Workflow Integration

**Git Diff Analysis:**
- Click "Analyze Diff" in the Git tab to get AI insights
- View inline comments aligned to specific code lines
- Add your own comments and replies to AI suggestions
- Comments persist and sync across sessions

**Smart Code Fixes:**
- Click "Apply Fixes" to automatically implement suggested improvements
- AI considers both its analysis and your comments
- Non-dismissed comments are included in fix generation
- Fixes are applied file-by-file for safety

**Change Management:**
- "Accept Changes" commits all modifications with AI-generated commit messages
- "Deny Changes" reverts all uncommitted changes
- Force delete worktrees with automatic git cleanup

### 4. GitHub Integration

**Prerequisites:**
```bash
gh auth login  # Authenticate with GitHub
```

**Pull Request Automation:**
- **"Update PR" Button**: Automatically updates existing PRs with:
  - AI-generated titles following conventional commit format
  - Comprehensive descriptions with Summary, Changes, and Testing sections
  - Current git diff analysis and commit history
- **Automatic Creation**: Creates new PR if none exists for the branch
- **Smart Fallback**: Falls back to branch push if GitHub CLI unavailable

**PR Workflow:**
1. Make changes in your worktree
2. Use Bob's git analysis and fix features
3. Click "Update PR" to sync with GitHub
4. PR title and description are automatically generated and updated

### 5. System Status Dashboard

**Dependency Monitoring:**
- ✅ **Claude CLI Status**: Shows availability and version
- ✅ **GitHub CLI Status**: Shows installation, authentication, and user
- ⚠️ **Authentication Warnings**: Helpful guidance when setup needed
- ❌ **Missing Tools**: Clear indicators when dependencies unavailable

**Real-time Metrics:**
- Repository count and worktree statistics
- Active vs total Claude instances
- Server uptime and memory usage
- Updates every 10 seconds

## Development Workflow

### Recommended Workflow

1. **Start Bob**
   ```bash
   npm run dev:clean
   ```

2. **Add Repository**
   - Click "Add Repository" → Select your project
   - Or use existing repositories

3. **Create Feature Branch**
   - Click "+" next to repository
   - Enter branch name: `feature-awesome-feature`
   - Bob creates worktree and starts Claude instance

4. **Develop with AI Assistance**
   - Code in your worktree directory
   - Use Claude tab for AI assistance
   - Analyze changes with Git tab

5. **Create/Update Pull Request**
   - Click "Update PR" for automatic GitHub integration
   - AI generates professional PR title and description
   - Continue iterating and updating as needed

6. **Clean Up**
   - Delete worktree when feature is merged
   - Bob handles git cleanup automatically

### Branch Switching Notes

When switching branches, always run `npm run dev:clean` to:
1. Kill any existing development processes
2. Clear port conflicts
3. Start fresh development environment

This prevents conflicts when multiple dev servers try to use the same ports.

### Worktree Management

**Worktree Lifecycle:**
1. **Creation**: `git worktree add ~/.bob/repo-branch -b branch origin/main`
2. **Claude Instance**: Automatically started for each worktree
3. **Development**: Isolated environment with dedicated Claude session
4. **Cleanup**: Safe deletion with merge status checking

**Force Deletion:**
- Available for worktrees with uncommitted changes
- Automatically reverts changes: `git reset --hard HEAD && git clean -fd`
- Deletes both worktree and branch for complete cleanup

## Technical Architecture

### Backend Services
- **GitService**: Repository and worktree management
- **ClaudeService**: Instance lifecycle and communication
- **TerminalService**: WebSocket-based terminal connections
- **DatabaseService**: SQLite for persistence

### Frontend Components
- **RepositoryPanel**: Repository and worktree management UI
- **TerminalPanel**: Claude interface and git operations
- **SystemStatusDashboard**: Dependency monitoring and metrics

### API Endpoints
- `/api/repositories` - Repository CRUD operations
- `/api/instances` - Claude instance management
- `/api/git/:worktreeId/*` - Git operations and analysis
- `/api/system-status` - Dependency and system health checks

## Troubleshooting

### Common Issues

**Claude CLI Not Available:**
```bash
# Install Claude CLI first
curl -fsSL https://claude.ai/install.sh | sh
```

**GitHub CLI Authentication:**
```bash
gh auth login
gh auth status  # Verify authentication
```

**Port Conflicts:**
```bash
npm run dev:clean  # Always use clean start
```

**Worktree Issues:**
- Check System Status dashboard for dependency issues
- Verify git repository is properly initialized
- Ensure sufficient disk space in `~/.bob/` directory

### System Status Indicators

- ✅ **Green**: Fully functional
- ⚠️ **Yellow**: Partially functional (e.g., not authenticated)
- ❌ **Red**: Not available or broken
- ❓ **Gray**: Unknown status

## Port Information
- **Frontend**: http://localhost:5173 (Vite)
- **Backend**: http://localhost:3001 (Express)
- **WebSocket**: ws://localhost:3001 (Terminal connections)