import React, { useState, useEffect, useRef } from 'react';
import { ClaudeInstance, Worktree } from '../types';
import { TerminalComponent } from './Terminal';
import { api } from '../api';

interface TerminalPanelProps {
  selectedWorktree: Worktree | null;
  selectedInstance: ClaudeInstance | null;
  onCreateTerminalSession: (instanceId: string) => Promise<string>;
  onCreateDirectoryTerminalSession: (instanceId: string) => Promise<string>;
  onCloseTerminalSession: (sessionId: string) => void;
  onRestartInstance: (instanceId: string) => Promise<void>;
  onStopInstance: (instanceId: string) => Promise<void>;
  error: string | null;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  selectedWorktree,
  selectedInstance,
  onCreateTerminalSession,
  onCreateDirectoryTerminalSession,
  onCloseTerminalSession,
  onRestartInstance,
  onStopInstance,
  error
}) => {
  const [claudeTerminalSessionId, setClaudeTerminalSessionId] = useState<string | null>(null);
  const [directoryTerminalSessionId, setDirectoryTerminalSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'claude' | 'directory'>('claude');
  const [isCreatingClaudeSession, setIsCreatingClaudeSession] = useState(false);
  const [isCreatingDirectorySession, setIsCreatingDirectorySession] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const lastAutoConnectInstance = useRef<string>('');

  useEffect(() => {
    // Clear frontend terminal state when switching instances (but keep backend sessions alive)
    console.log(`Switching to instance: ${selectedInstance?.id}, clearing session state`);
    setClaudeTerminalSessionId(null);
    setDirectoryTerminalSessionId(null);
  }, [selectedInstance?.id]);

  // Auto-connect to existing terminal sessions or create new ones when instance first becomes running
  useEffect(() => {
    if (selectedInstance && 
        selectedInstance.status === 'running' && 
        !claudeTerminalSessionId && 
        !directoryTerminalSessionId &&
        !isCreatingClaudeSession &&
        !isCreatingDirectorySession) {
      
      // Only proceed if this is a new instance or status change to running
      const currentInstanceKey = `${selectedInstance.id}-${selectedInstance.status}`;
      
      if (lastAutoConnectInstance.current !== currentInstanceKey) {
        lastAutoConnectInstance.current = currentInstanceKey;
        
        console.log(`Auto-connecting to instance ${selectedInstance.id} (status: ${selectedInstance.status})`);
        
        // Add a small delay to ensure state has settled after instance switch
        const timeoutId = setTimeout(() => {
          checkExistingSessionsOrConnect();
        }, 100);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [selectedInstance?.status, selectedInstance?.id]); // Remove session IDs from dependencies

  const handleOpenClaudeTerminal = async () => {
    if (!selectedInstance || selectedInstance.status !== 'running') return;
    
    setIsCreatingClaudeSession(true);
    try {
      // First check for existing Claude session
      const existingSessions = await api.getTerminalSessions(selectedInstance.id);
      const claudeSession = existingSessions.find(s => s.type === 'claude');
      
      if (claudeSession) {
        // Rejoin existing session
        setClaudeTerminalSessionId(claudeSession.id);
      } else {
        // Create new session
        const sessionId = await onCreateTerminalSession(selectedInstance.id);
        setClaudeTerminalSessionId(sessionId);
      }
      setActiveTab('claude');
    } catch (error) {
      console.error('Failed to create Claude terminal session:', error);
      // Error will be shown via the error prop from parent component
    } finally {
      setIsCreatingClaudeSession(false);
    }
  };

  const handleOpenDirectoryTerminal = async () => {
    if (!selectedInstance) return;
    
    setIsCreatingDirectorySession(true);
    try {
      // First check for existing directory session
      const existingSessions = await api.getTerminalSessions(selectedInstance.id);
      const directorySession = existingSessions.find(s => s.type === 'directory');
      
      if (directorySession) {
        // Rejoin existing session
        setDirectoryTerminalSessionId(directorySession.id);
      } else {
        // Create new session
        const sessionId = await onCreateDirectoryTerminalSession(selectedInstance.id);
        setDirectoryTerminalSessionId(sessionId);
      }
      setActiveTab('directory');
    } catch (error) {
      console.error('Failed to create directory terminal session:', error);
    } finally {
      setIsCreatingDirectorySession(false);
    }
  };

  const handleCloseTerminal = (terminalType: 'claude' | 'directory') => {
    if (terminalType === 'claude' && claudeTerminalSessionId) {
      onCloseTerminalSession(claudeTerminalSessionId);
      setClaudeTerminalSessionId(null);
    } else if (terminalType === 'directory' && directoryTerminalSessionId) {
      onCloseTerminalSession(directoryTerminalSessionId);
      setDirectoryTerminalSessionId(null);
    }
  };

  const handleRestartInstance = async () => {
    if (!selectedInstance) return;
    
    setIsRestarting(true);
    try {
      // Close any existing terminal sessions
      if (claudeTerminalSessionId) {
        onCloseTerminalSession(claudeTerminalSessionId);
        setClaudeTerminalSessionId(null);
      }
      if (directoryTerminalSessionId) {
        onCloseTerminalSession(directoryTerminalSessionId);
        setDirectoryTerminalSessionId(null);
      }
      
      await onRestartInstance(selectedInstance.id);
    } catch (error) {
      console.error('Failed to restart instance:', error);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleStopInstance = async () => {
    if (!selectedInstance) return;
    
    setIsStopping(true);
    try {
      // Close any existing terminal sessions
      if (claudeTerminalSessionId) {
        onCloseTerminalSession(claudeTerminalSessionId);
        setClaudeTerminalSessionId(null);
      }
      if (directoryTerminalSessionId) {
        onCloseTerminalSession(directoryTerminalSessionId);
        setDirectoryTerminalSessionId(null);
      }
      
      await onStopInstance(selectedInstance.id);
    } catch (error) {
      console.error('Failed to stop instance:', error);
    } finally {
      setIsStopping(false);
    }
  };

  const checkExistingSessionsOrConnect = async () => {
    if (!selectedInstance) return;
    
    console.log(`checkExistingSessionsOrConnect called for instance ${selectedInstance.id}`);
    
    try {
      // Check for existing terminal sessions
      const existingSessions = await api.getTerminalSessions(selectedInstance.id);
      console.log(`Found ${existingSessions.length} existing sessions for instance ${selectedInstance.id}:`, existingSessions);
      
      // Look for existing Claude and directory sessions
      const claudeSession = existingSessions.find(s => s.type === 'claude');
      const directorySession = existingSessions.find(s => s.type === 'directory');
      
      if (claudeSession) {
        // Rejoin existing Claude session
        console.log(`Rejoining existing Claude session: ${claudeSession.id}, current activeTab: ${activeTab}`);
        setClaudeTerminalSessionId(claudeSession.id);
        // Ensure we're on the Claude tab to show the reconnected session
        if (activeTab !== 'claude') {
          console.log(`Setting activeTab to claude (was ${activeTab})`);
          setActiveTab('claude');
        } else {
          console.log(`Already on claude tab, session should be visible`);
        }
      } else if (directorySession) {
        // Rejoin existing directory session
        console.log(`Rejoining existing directory session: ${directorySession.id}, current activeTab: ${activeTab}`);
        setDirectoryTerminalSessionId(directorySession.id);
        if (activeTab !== 'directory') {
          console.log(`Setting activeTab to directory (was ${activeTab})`);
          setActiveTab('directory');
        } else {
          console.log(`Already on directory tab, session should be visible`);
        }
      } else {
        // No existing sessions, create new Claude session
        console.log('No existing sessions found, creating new Claude session');
        setActiveTab('claude');
        await handleOpenClaudeTerminal();
      }
    } catch (error) {
      console.error('Failed to check existing sessions:', error);
      // Fallback to creating new Claude session
      setActiveTab('claude');
      await handleOpenClaudeTerminal();
    }
  };

  if (!selectedWorktree) {
    return (
      <div className="right-panel">
        <div className="panel-header">
          <h3 style={{ margin: 0, color: '#ffffff' }}>Terminal</h3>
        </div>
        <div className="empty-terminal">
          <div>
            <h4 style={{ color: '#666', marginBottom: '8px' }}>No worktree selected</h4>
            <p style={{ color: '#888', fontSize: '14px' }}>
              Select a worktree from the left panel to view its Claude instance
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedInstance) {
    return (
      <div className="right-panel">
        <div className="panel-header">
          <h3 style={{ margin: 0, color: '#ffffff' }}>Terminal</h3>
          <span style={{ fontSize: '12px', color: '#888' }}>
            {selectedWorktree.branch} • {selectedWorktree.path}
          </span>
        </div>
        <div className="empty-terminal">
          <div>
            <h4 style={{ color: '#666', marginBottom: '8px' }}>No Claude instance</h4>
            <p style={{ color: '#888', fontSize: '14px' }}>
              This worktree doesn't have a running Claude instance
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="right-panel">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0, color: '#ffffff' }}>
            Claude Instance
            <span 
              className={`status ${selectedInstance.status}`}
              style={{ 
                marginLeft: '12px',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '3px',
                backgroundColor: 
                  selectedInstance.status === 'running' ? '#28a745' :
                  selectedInstance.status === 'starting' ? '#ffc107' :
                  selectedInstance.status === 'stopped' ? '#6c757d' : '#dc3545',
                color: selectedInstance.status === 'starting' ? '#000' : '#fff'
              }}
            >
              {selectedInstance.status}
            </span>
          </h3>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
            {selectedWorktree.branch} • {selectedWorktree.path}
            {selectedInstance.pid && <span> • PID: {selectedInstance.pid}</span>}
            {selectedInstance.port && <span> • Port: {selectedInstance.port}</span>}
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          {selectedInstance.status === 'running' && (
            <button
              onClick={handleStopInstance}
              disabled={isStopping}
              className="button danger"
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              {isStopping ? 'Stopping...' : 'Stop Claude'}
            </button>
          )}
          
          {(selectedInstance.status === 'stopped' || selectedInstance.status === 'error') && (
            <button
              onClick={handleRestartInstance}
              disabled={isRestarting}
              className="button"
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              {isRestarting ? 'Restarting...' : 'Restart Claude'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ 
          background: '#2d1b1b', 
          border: '1px solid #5a1f1f', 
          color: '#ff6b6b', 
          padding: '12px 16px', 
          fontSize: '14px',
          borderBottom: '1px solid #333'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Tabbed interface */}
      <div style={{ display: 'flex', borderBottom: '1px solid #444' }}>
        <button
          onClick={() => {
            setActiveTab('claude');
            // If switching to Claude tab but no session exists, check for existing sessions
            if (!claudeTerminalSessionId && selectedInstance?.status === 'running') {
              setTimeout(() => handleOpenClaudeTerminal(), 100);
            }
          }}
          style={{
            background: activeTab === 'claude' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'claude' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Claude {claudeTerminalSessionId && '●'}
        </button>
        <button
          onClick={() => {
            setActiveTab('directory');
            // If switching to Terminal tab but no session exists, check for existing sessions
            if (!directoryTerminalSessionId && selectedInstance?.status === 'running') {
              setTimeout(() => handleOpenDirectoryTerminal(), 100);
            }
          }}
          style={{
            background: activeTab === 'directory' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'directory' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Terminal {directoryTerminalSessionId && '●'}
        </button>
      </div>

      <div className="terminal-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Claude Terminal */}
        <div style={{ 
          display: activeTab === 'claude' ? 'flex' : 'none', 
          flexDirection: 'column', 
          flex: 1,
          minHeight: 0 
        }}>
          {claudeTerminalSessionId ? (
            <>
              {console.log(`Rendering Claude TerminalComponent with sessionId: ${claudeTerminalSessionId}`)}
              <TerminalComponent
                key={claudeTerminalSessionId}
                sessionId={claudeTerminalSessionId}
                onClose={() => handleCloseTerminal('claude')}
              />
            </>
          ) : selectedInstance.status === 'running' ? (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Claude Terminal</h4>
                {isCreatingClaudeSession ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#888' }}>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      border: '2px solid #444', 
                      borderTop: '2px solid #888', 
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite' 
                    }}></div>
                    Connecting to Claude...
                  </div>
                ) : (
                  <>
                    <p style={{ color: '#888', fontSize: '14px', marginBottom: '16px' }}>
                      Connect to the running Claude instance for AI assistance
                    </p>
                    <button
                      onClick={handleOpenClaudeTerminal}
                      className="button"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      Connect to Claude
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : selectedInstance.status === 'starting' ? (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Claude Terminal</h4>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#888' }}>
                  <div style={{ 
                    width: '16px', 
                    height: '16px', 
                    border: '2px solid #444', 
                    borderTop: '2px solid #ffc107', 
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite' 
                  }}></div>
                  Starting Claude instance...
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Claude Terminal</h4>
                <p style={{ color: '#888', fontSize: '14px' }}>
                  Claude instance must be running to connect
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Directory Terminal */}
        <div style={{ 
          display: activeTab === 'directory' ? 'flex' : 'none', 
          flexDirection: 'column', 
          flex: 1,
          minHeight: 0 
        }}>
          {directoryTerminalSessionId ? (
            <TerminalComponent
              sessionId={directoryTerminalSessionId}
              onClose={() => handleCloseTerminal('directory')}
            />
          ) : (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Directory Terminal</h4>
                <p style={{ color: '#888', fontSize: '14px', marginBottom: '16px' }}>
                  Open a bash shell in the worktree directory
                </p>
                {!isCreatingDirectorySession ? (
                  <button
                    onClick={handleOpenDirectoryTerminal}
                    className="button"
                    style={{ fontSize: '14px', padding: '8px 16px' }}
                  >
                    Open Terminal
                  </button>
                ) : (
                  <div style={{ color: '#888' }}>Connecting...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};