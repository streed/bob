import React, { useState } from 'react';
import { Repository, Worktree, ClaudeInstance } from '../types';
import { DirectoryBrowser } from './DirectoryBrowser';
import { DeleteWorktreeModal } from './DeleteWorktreeModal';

interface RepositoryPanelProps {
  repositories: Repository[];
  instances: ClaudeInstance[];
  selectedWorktreeId: string | null;
  onAddRepository: (path: string) => void;
  onCreateWorktreeAndStartInstance: (repositoryId: string, branchName: string) => void;
  onSelectWorktree: (worktreeId: string) => Promise<void>;
  onDeleteWorktree: (worktreeId: string, force: boolean) => Promise<void>;
}

export const RepositoryPanel: React.FC<RepositoryPanelProps> = ({
  repositories,
  instances,
  selectedWorktreeId,
  onAddRepository,
  onCreateWorktreeAndStartInstance,
  onSelectWorktree,
  onDeleteWorktree
}) => {
  const [showDirectoryBrowser, setShowDirectoryBrowser] = useState(false);
  const [showNewWorktreeForm, setShowNewWorktreeForm] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [worktreeToDelete, setWorktreeToDelete] = useState<Worktree | null>(null);
  const [startingInstances, setStartingInstances] = useState<Set<string>>(new Set());
  const [copiedWorktreeId, setCopiedWorktreeId] = useState<string | null>(null);

  const handleDirectorySelect = (path: string) => {
    onAddRepository(path);
    setShowDirectoryBrowser(false);
  };

  const handleCreateWorktree = (repositoryId: string) => {
    if (newBranchName.trim()) {
      onCreateWorktreeAndStartInstance(repositoryId, newBranchName.trim());
      setNewBranchName('');
      setShowNewWorktreeForm(null);
    }
  };

  const getWorktreeStatus = (worktree: Worktree) => {
    const worktreeInstances = instances.filter(i => i.worktreeId === worktree.id);
    if (worktreeInstances.length === 0) return { status: 'none', label: 'No Instance' };
    
    // Since we enforce single instance per worktree, just get the first (and only) instance
    const instance = worktreeInstances[0];
    
    switch (instance.status) {
      case 'running':
        return { status: 'running', label: 'Running' };
      case 'starting':
        return { status: 'starting', label: 'Starting' };
      case 'error':
        return { status: 'error', label: 'Error' };
      case 'stopped':
      default:
        return { status: 'stopped', label: 'Stopped' };
    }
  };

  const getBranchDisplayName = (branch: string) => {
    // Extract the branch name from refs/heads/branch-name or just return branch name
    return branch.replace(/^refs\/heads\//, '');
  };

  const handleWorktreeSelect = async (worktreeId: string) => {
    // Mark this worktree as having an instance being started
    setStartingInstances(prev => new Set(prev).add(worktreeId));

    try {
      await onSelectWorktree(worktreeId);
    } finally {
      // Remove from starting instances after a delay to let the status update
      setTimeout(() => {
        setStartingInstances(prev => {
          const newSet = new Set(prev);
          newSet.delete(worktreeId);
          return newSet;
        });
      }, 2000);
    }
  };

  const handleCopyWorktreeLink = async (worktreeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('worktree', worktreeId);
    const linkUrl = currentUrl.toString();

    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopiedWorktreeId(worktreeId);
      setTimeout(() => setCopiedWorktreeId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      // Fallback: show the URL in a prompt
      prompt('Copy this link:', linkUrl);
    }
  };

  return (
    <div className="left-panel">
      <div className="panel-header">
        <h3 style={{ margin: 0, color: '#ffffff' }}>Repositories</h3>
      </div>

      <div className="add-repo-section">
        <button 
          onClick={() => setShowDirectoryBrowser(true)}
          className="add-repo-btn"
        >
          <span>+</span>
          Add Repository
        </button>
      </div>

      <div className="panel-content">
        {repositories.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', marginTop: '40px' }}>
            <p>No repositories added</p>
            <p style={{ fontSize: '12px' }}>Click "Add Repository" to get started</p>
          </div>
        ) : (
          <div className="repository-list">
            {repositories.map(repo => (
              <div key={repo.id} className="repository-item">
                <div className="repository-header">
                  <div className="repository-info">
                    <h4>{repo.name}</h4>
                    <p>{repo.path}</p>
                  </div>
                  <button
                    onClick={() => setShowNewWorktreeForm(repo.id)}
                    className="add-worktree-btn"
                    title="Create new worktree and start Claude instance"
                  >
                    +
                  </button>
                </div>

                {showNewWorktreeForm === repo.id && (
                  <div style={{ padding: '12px 16px', background: '#2a2a2a', borderTop: '1px solid #444' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        placeholder="Branch name (e.g., feature-xyz)"
                        className="input"
                        style={{ flex: 1, fontSize: '12px', padding: '6px 8px' }}
                        onKeyPress={(e) => e.key === 'Enter' && handleCreateWorktree(repo.id)}
                        autoFocus
                      />
                      <button
                        onClick={() => handleCreateWorktree(repo.id)}
                        disabled={!newBranchName.trim()}
                        className="button"
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        Create
                      </button>
                      <button
                        onClick={() => {
                          setShowNewWorktreeForm(null);
                          setNewBranchName('');
                        }}
                        className="button secondary"
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Only show actual git worktrees (not the main working tree) */}
                {repo.worktrees.filter(worktree => {
                  // Exclude main working trees that are not managed by Bob
                  return !worktree.isMainWorktree;
                }).length > 0 && (
                  <div className="worktrees-list">
                    {repo.worktrees
                      .filter(worktree => {
                        // Exclude main working trees that are not managed by Bob
                        return !worktree.isMainWorktree;
                      })
                      .map(worktree => {
                      const status = getWorktreeStatus(worktree);
                      const isSelected = selectedWorktreeId === worktree.id;
                      const isStarting = startingInstances.has(worktree.id);
                      
                      return (
                        <div
                          key={worktree.id}
                          className={`worktree-item ${isSelected ? 'active' : ''}`}
                        >
                          <div 
                            onClick={() => handleWorktreeSelect(worktree.id)}
                            style={{ 
                              cursor: 'pointer', 
                              flex: 1, 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center' 
                            }}
                          >
                            <div className="worktree-info">
                              <div className="worktree-name">{getBranchDisplayName(worktree.branch)}</div>
                              <div className="worktree-path">{worktree.path}</div>
                            </div>
                            <div
                              className={`instance-status ${isStarting ? 'starting' : status.status}`}
                              style={{
                                backgroundColor:
                                  isStarting ? '#ffc107' :
                                  status.status === 'running' ? '#28a745' :
                                  status.status === 'starting' ? '#ffc107' :
                                  status.status === 'error' ? '#dc3545' :
                                  status.status === 'stopped' ? '#6c757d' :
                                  status.status === 'none' ? '#888' : '#444',
                                color:
                                  isStarting || status.status === 'starting' ? '#000' :
                                  status.status === 'none' ? '#fff' :
                                  '#fff'
                              }}
                            >
                              {isStarting ? 'Starting...' : status.label}
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleCopyWorktreeLink(worktree.id, e)}
                            style={{
                              background: copiedWorktreeId === worktree.id ? '#28a745' : '#6c757d',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              marginLeft: '8px',
                              flexShrink: 0
                            }}
                            title={copiedWorktreeId === worktree.id ? "Link copied!" : "Copy direct link to this worktree"}
                          >
                            {copiedWorktreeId === worktree.id ? '✓' : '🔗'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setWorktreeToDelete(worktree);
                            }}
                            style={{
                              background: '#dc3545',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              marginLeft: '8px',
                              flexShrink: 0
                            }}
                            title="Delete worktree"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showDirectoryBrowser && (
        <DirectoryBrowser
          onSelectDirectory={handleDirectorySelect}
          onClose={() => setShowDirectoryBrowser(false)}
        />
      )}
      
      {worktreeToDelete && (
        <DeleteWorktreeModal
          worktree={worktreeToDelete}
          onClose={() => setWorktreeToDelete(null)}
          onConfirm={onDeleteWorktree}
        />
      )}
    </div>
  );
};