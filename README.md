# Bob

Bob is a web application for managing multiple Claude Code instances across git repositories and worktrees.

## Features

- **Repository Discovery**: Automatically find git repositories in your filesystem
- **Worktree Management**: Create and manage git worktrees for parallel feature development
- **Instance Management**: Start, stop, and monitor Claude Code instances
- **Terminal Interface**: Direct terminal access to interact with Claude agents
- **Repository Grouping**: Organize instances by git repository
- **Real-time Status**: Live monitoring of instance status and activity

## Architecture

- **Backend**: Node.js with Express and WebSocket server
- **Frontend**: React with TypeScript
- **Terminal**: xterm.js with WebSocket communication
- **Git Integration**: Native git command integration for worktree management

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- Git
- Claude Code CLI (`claude`)

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development servers:
   ```bash
   npm run dev
   ```

   This starts both the backend server (port 3001) and frontend dev server (port 5173).

### Usage

1. **Discover Repositories**: Enter search paths to find git repositories
2. **Create Worktrees**: Select a repository and create new worktrees for feature branches
3. **Start Instances**: Launch Claude Code instances in your worktrees
4. **Use Terminal**: Open terminal sessions to interact directly with Claude agents

## API Endpoints

### Repositories
- `GET /api/repositories` - List all repositories
- `POST /api/repositories/discover` - Discover repositories in search paths
- `POST /api/repositories/:id/worktrees` - Create new worktree
- `DELETE /api/repositories/worktrees/:worktreeId` - Remove worktree

### Instances
- `GET /api/instances` - List all Claude instances
- `POST /api/instances` - Start new instance
- `DELETE /api/instances/:id` - Stop instance
- `POST /api/instances/:id/terminal` - Create terminal session

### WebSocket
- `/ws?sessionId=<session_id>` - Terminal WebSocket connection

## Development

### Backend Development
```bash
cd backend
npm run dev
```

### Frontend Development
```bash
cd frontend
npm run dev
```

### Building for Production
```bash
npm run build
```

## Database Management

The application uses SQLite with a migration system for schema management.

### Migration Commands
```bash
cd backend

# Check migration status
npm run migrate:status

# Run pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Create new migration
npm run migrate:create "add new feature"

# Reset database (destructive)
npm run migrate:reset
```

### Database Location
- **Development**: `bob.db` in project root
- **Production**: Configurable via database path parameter

## Configuration

The application uses the following default settings:
- Backend port: 3001
- Claude instances start on ports 3100+
- WebSocket connections for terminal sessions
- Git worktrees created adjacent to main repository

## Security Considerations

- Terminal sessions provide full shell access
- Only use on trusted networks
- Consider authentication for production deployments
- Git operations require appropriate permissions

## Troubleshooting

### Claude Code Not Found
Ensure the `claude` CLI is installed and available in your PATH.

### Permission Errors
Make sure you have read/write access to the directories where you're discovering repositories.

### WebSocket Connection Issues
Check that the WebSocket endpoint is accessible and not blocked by firewalls.