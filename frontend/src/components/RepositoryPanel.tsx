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
  onCheckStates?: () => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const RepositoryPanel: React.FC<RepositoryPanelProps> = ({
  repositories,
  instances,
  selectedWorktreeId,
  onAddRepository,
  onCreateWorktreeAndStartInstance,
  onSelectWorktree,
  onDeleteWorktree,
  onCheckStates,
  isCollapsed,
  onToggleCollapse
}) => {
  const [showDirectoryBrowser, setShowDirectoryBrowser] = useState(false);
  const [showNewWorktreeForm, setShowNewWorktreeForm] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [worktreeToDelete, setWorktreeToDelete] = useState<Worktree | null>(null);
  const [startingInstances, setStartingInstances] = useState<Set<string>>(new Set());
  const [copiedWorktreeId, setCopiedWorktreeId] = useState<string | null>(null);
  const [isCheckingStates, setIsCheckingStates] = useState(false);

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
    const hasInstance = worktreeInstances.length > 0;
    
    // Show worktree state as primary status
    let stateInfo = {
      status: 'working',
      label: 'Working',
      color: '#17a2b8' // blue for working
    };
    
    switch (worktree.state) {
      case 'review':
        stateInfo = { status: 'review', label: 'In Review', color: '#ffc107' }; // yellow for review
        break;
      case 'done':
        stateInfo = { status: 'done', label: 'Done', color: '#28a745' }; // green for done
        break;
      default:
        stateInfo = { status: 'working', label: 'Working', color: '#17a2b8' }; // blue for working
    }
    
    // Add instance status as secondary info if there's an instance
    if (hasInstance) {
      const instance = worktreeInstances[0];
      let instanceStatus = '';
      
      switch (instance.status) {
        case 'running':
          instanceStatus = ' (Claude Running)';
          break;
        case 'starting':
          instanceStatus = ' (Claude Starting)';
          break;
        case 'error':
          instanceStatus = ' (Claude Error)';
          break;
        case 'stopped':
          instanceStatus = ' (Claude Stopped)';
          break;
      }
      
      return {
        ...stateInfo,
        label: stateInfo.label + instanceStatus
      };
    }
    
    return stateInfo;
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

  const handleCheckStates = async () => {
    if (!onCheckStates || isCheckingStates) return;
    
    setIsCheckingStates(true);
    try {
      await onCheckStates();
    } finally {
      setIsCheckingStates(false);
    }
  };

  return (
    <div className={`left-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {!isCollapsed && <h3 style={{ margin: 0, color: '#ffffff' }}>Repositories</h3>}
          <button
            onClick={onToggleCollapse}
            className="collapse-toggle-btn"
            title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
            style={{
              background: 'transparent',
              border: '1px solid #555',
              color: '#ffffff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px'
            }}
          >
            {isCollapsed ? '▶' : '◀'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="add-repo-section">
            <button 
              onClick={() => setShowDirectoryBrowser(true)}
              className="add-repo-btn"
            >
              <span>+</span>
              Add Repository
            </button>
            {onCheckStates && (
              <button 
                onClick={handleCheckStates}
                disabled={isCheckingStates}
                className="add-repo-btn"
                style={{ 
                  marginTop: '8px',
                  backgroundColor: isCheckingStates ? '#555' : '#4a90e2',
                  cursor: isCheckingStates ? 'not-allowed' : 'pointer'
                }}
                title="Check all worktree states for PR and merge status"
              >
                {isCheckingStates ? '⟳ Checking...' : '🔄 Check States'}
              </button>
            )}
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

                    {/* Only show actual git worktrees (not regular git branches) for safety */}
                    {repo.worktrees.filter(worktree => {
                      const branchName = worktree.branch.toLowerCase();
                      return !branchName.endsWith('/main') && !branchName.endsWith('/master');
                    }).length > 0 && (
                      <div className="worktrees-list">
                        {repo.worktrees
                          .filter(worktree => {
                            const branchName = worktree.branch.toLowerCase();
                            return !branchName.endsWith('/main') && !branchName.endsWith('/master');
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
                                    backgroundColor: isStarting ? '#ffc107' : status.color,
                                    color: '#fff',
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 'bold'
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
        </>
      )}

      {/* Quick access collapsed view */}
      {isCollapsed && repositories.length > 0 && (
        <div className="collapsed-content">
          {repositories.map(repo => 
            repo.worktrees
              .filter(worktree => {
                const branchName = worktree.branch.toLowerCase();
                return !branchName.endsWith('/main') && !branchName.endsWith('/master');
              })
              .map(worktree => {
                const status = getWorktreeStatus(worktree);
                const isSelected = selectedWorktreeId === worktree.id;
                const isStarting = startingInstances.has(worktree.id);
                
                return (
                  <div
                    key={worktree.id}
                    className={`collapsed-worktree-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleWorktreeSelect(worktree.id)}
                    title={`${getBranchDisplayName(worktree.branch)} - ${worktree.path}`}
                    style={{
                      padding: '8px 12px',
                      margin: '4px 0',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: isSelected ? '#007acc' : '#2a2a2a',
                      border: '1px solid #444',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <div style={{
                      fontSize: '11px',
                      fontWeight: 'bold',
                      color: '#fff',
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: '100%'
                    }}>
                      {getBranchDisplayName(worktree.branch)}
                    </div>
                    <div
                      style={{
                        fontSize: '8px',
                        padding: '1px 4px',
                        borderRadius: '2px',
                        backgroundColor: isStarting ? '#ffc107' : status.color,
                        color: '#fff'
                      }}
                    >
                      {isStarting ? 'Starting...' : status.label}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}

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