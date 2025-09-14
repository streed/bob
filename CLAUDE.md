# Bob Project - Claude Development Guide

## Development Commands

### Starting Development Servers

```bash
# Clean start (recommended when switching branches)
npm run dev:clean

# Regular start (only if no conflicts exist)  
npm run dev
```

### Project Structure
- `/frontend` - React/Vite frontend application
- `/backend` - Node.js/Express backend application
- Root package.json orchestrates both with concurrently

### Important Notes for Branch Switching

When switching branches, always run `npm run dev:clean` to:
1. Kill any existing development processes
2. Clear port conflicts 
3. Start fresh development environment

This prevents the "horribly broken" state where multiple dev servers conflict when switching branches.

### Worktree Switching in Bob UI

When switching between worktrees in the Bob application:
1. Claude instances are automatically started/restarted for the selected worktree
2. The Claude interface appears in the right panel terminal area (Claude tab)
3. Each worktree runs its own isolated Claude instance
4. All interaction happens within the Bob UI - no new tabs or windows

### Development Workflow

1. Switch to your branch: `git checkout <branch-name>`
2. Clean start: `npm run dev:clean`  
3. Develop your features
4. Before switching branches: Stop servers (Ctrl+C) or run `npm run dev:stop`

### Port Information
- Frontend: http://localhost:5173 (Vite)
- Backend: http://localhost:3000 (Express)