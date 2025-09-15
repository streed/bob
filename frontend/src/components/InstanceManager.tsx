import React from 'react';
import { Repository, ClaudeInstance } from '../types';

interface InstanceManagerProps {
  repositories: Repository[];
  instances: ClaudeInstance[];
  onStartInstance: (worktreeId: string) => void;
  onStopInstance: (instanceId: string) => void;
  onOpenTerminal: (instanceId: string) => void;
}

export const InstanceManager: React.FC<InstanceManagerProps> = ({
  repositories,
  instances,
  onStartInstance,
  onStopInstance,
  onOpenTerminal
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#28a745';
      case 'starting': return '#ffc107';
      case 'stopped': return '#6c757d';
      case 'error': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const repositoriesWithInstances = repositories.map(repo => {
    const repoInstances = instances.filter(i => i.repositoryId === repo.id);
    return { ...repo, instances: repoInstances };
  }).filter(repo => repo.worktrees.length > 0);

  return (
    <div className="section">
      <h2>Claude Code Instances</h2>

      {repositoriesWithInstances.length === 0 ? (
        <div className="empty-state">
          <h3>No worktrees available</h3>
          <p>Create some worktrees first to start Claude Code instances</p>
        </div>
      ) : (
        repositoriesWithInstances.map(repo => (
          <div key={repo.id} className="repository-group">
            <div className="repository-header">
              <h3>{repo.name}</h3>
              <p style={{ margin: 0, color: '#ccc' }}>{repo.path}</p>
            </div>
            
            <div className="repository-content">
              {repo.worktrees.map(worktree => {
                const worktreeInstances = instances.filter(i => i.worktreeId === worktree.id);
                const hasRunningInstance = worktreeInstances.some(i => i.status === 'running');
                
                return (
                  <div key={worktree.id} className="worktree">
                    <div className="worktree-header">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{worktree.branch}</span>
                        <div>
                          {!hasRunningInstance ? (
                            <button
                              onClick={() => onStartInstance(worktree.id)}
                              className="button"
                              style={{ fontSize: '12px', padding: '4px 8px' }}
                            >
                              Start Claude
                            </button>
                          ) : (
                            <span style={{ 
                              fontSize: '12px', 
                              color: '#28a745',
                              background: 'rgba(40, 167, 69, 0.1)',
                              padding: '2px 6px',
                              borderRadius: '3px'
                            }}>
                              Running
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                        {worktree.path}
                      </div>
                    </div>
                    
                    <div className="worktree-content">
                      {worktreeInstances.length === 0 ? (
                        <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                          No instances running
                        </div>
                      ) : (
                        worktreeInstances.map(instance => (
                          <div key={instance.id} className="instance">
                            <div className="instance-info">
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                marginBottom: '4px' 
                              }}>
                                <span style={{ fontWeight: 'bold', marginRight: '8px' }}>
                                  {instance.id.slice(-8)}
                                </span>
                                <span 
                                  className={`status ${instance.status}`}
                                  style={{ 
                                    backgroundColor: getStatusColor(instance.status),
                                    color: instance.status === 'starting' ? '#212529' : 'white'
                                  }}
                                >
                                  {instance.status}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: '#aaa' }}>
                                {instance.pid && <span>PID: {instance.pid} • </span>}
                                {instance.port && <span>Port: {instance.port} • </span>}
                                Created: {formatDate(instance.createdAt)}
                                {instance.lastActivity && (
                                  <span> • Last activity: {formatDate(instance.lastActivity)}</span>
                                )}
                              </div>
                            </div>
                            
                            <div className="instance-actions">
                              {instance.status === 'running' && (
                                <button
                                  onClick={() => onOpenTerminal(instance.id)}
                                  className="button"
                                  style={{ fontSize: '12px', padding: '4px 8px' }}
                                >
                                  Terminal
                                </button>
                              )}
                              
                              <button
                                onClick={() => onStopInstance(instance.id)}
                                className="button danger"
                                style={{ fontSize: '12px', padding: '4px 8px' }}
                              >
                                Stop
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
};