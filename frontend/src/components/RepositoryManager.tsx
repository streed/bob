import React, { useState } from 'react';
import { Repository } from '../types';
import { DirectoryBrowser } from './DirectoryBrowser';

interface RepositoryManagerProps {
  repositories: Repository[];
  onAddRepository: (repositoryPath: string) => void;
  onCreateWorktree: (repositoryId: string, branchName: string, baseBranch?: string) => void;
}

export const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  onAddRepository,
  onCreateWorktree
}) => {
  console.log('RepositoryManager render - repositories:', repositories);
  const [repositoryPath, setRepositoryPath] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [showDirectoryBrowser, setShowDirectoryBrowser] = useState(false);

  const handleAddRepository = () => {
    if (repositoryPath.trim()) {
      onAddRepository(repositoryPath.trim());
      setRepositoryPath('');
    }
  };

  const handleCreateWorktree = () => {
    if (selectedRepo && newBranch) {
      onCreateWorktree(selectedRepo, newBranch, baseBranch || undefined);
      setNewBranch('');
      setSelectedRepo('');
    }
  };

  const handleDirectorySelect = (path: string) => {
    setRepositoryPath(path);
    setShowDirectoryBrowser(false);
  };

  return (
    <div className="section">
      <h2>Repository Management</h2>
      
      <div className="card">
        <h3>Add Repository</h3>
        <div style={{ marginBottom: '15px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <input
              type="text"
              value={repositoryPath}
              onChange={(e) => setRepositoryPath(e.target.value)}
              placeholder="Enter git repository path (e.g., /path/to/repo)"
              className="input"
              style={{ width: '400px' }}
            />
            <button 
              onClick={() => setShowDirectoryBrowser(true)} 
              className="button secondary"
            >
              Browse...
            </button>
            <button 
              onClick={handleAddRepository} 
              className="button"
              disabled={!repositoryPath.trim()}
            >
              Add Repository
            </button>
          </div>
        </div>
        <p style={{ fontSize: '14px', color: '#888' }}>
          Add a git repository by specifying its full path
        </p>
      </div>

      {repositories.length > 0 && (
        <div className="card">
          <h3>Create New Worktree</h3>
          <div style={{ marginBottom: '15px' }}>
            <select 
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="input"
              style={{ marginRight: '8px' }}
            >
              <option value="">Select repository...</option>
              {repositories.map(repo => (
                <option key={repo.id} value={repo.id}>
                  {repo.name} ({repo.path})
                </option>
              ))}
            </select>
            
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="New branch name"
              className="input"
              style={{ marginRight: '8px' }}
            />
            
            <input
              type="text"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="Base branch (optional)"
              className="input"
              style={{ marginRight: '8px' }}
            />
            
            <button 
              onClick={handleCreateWorktree}
              disabled={!selectedRepo || !newBranch}
              className="button"
            >
              Create Worktree
            </button>
          </div>
        </div>
      )}

      <div className="grid">
        {repositories.map(repo => (
          <div key={repo.id} className="card">
            <h3>{repo.name}</h3>
            <p><strong>Path:</strong> {repo.path}</p>
            <p><strong>Current Branch:</strong> {repo.branch}</p>
            <p><strong>Worktrees:</strong> {repo.worktrees.length}</p>
            
            {repo.worktrees.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <h4 style={{ color: '#ccc', marginBottom: '10px' }}>Worktrees:</h4>
                {repo.worktrees.map(worktree => (
                  <div key={worktree.id} style={{ 
                    background: '#333', 
                    padding: '8px 12px', 
                    borderRadius: '4px', 
                    marginBottom: '8px' 
                  }}>
                    <div><strong>{worktree.branch}</strong></div>
                    <div style={{ fontSize: '12px', color: '#888' }}>{worktree.path}</div>
                    {worktree.instances.length > 0 && (
                      <div style={{ fontSize: '12px', color: '#28a745', marginTop: '4px' }}>
                        {worktree.instances.length} active instance(s)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {repositories.length === 0 && (
        <div className="empty-state">
          <h3>No repositories added</h3>
          <p>Add a git repository by entering its path above</p>
        </div>
      )}

      {showDirectoryBrowser && (
        <DirectoryBrowser
          onSelectDirectory={handleDirectorySelect}
          onClose={() => setShowDirectoryBrowser(false)}
        />
      )}
    </div>
  );
};