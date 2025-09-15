import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Repository, ClaudeInstance, Worktree } from './types';
import { api } from './api';
import { RepositoryPanel } from './components/RepositoryPanel';
import { TerminalPanel } from './components/TerminalPanel';

function App() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [instances, setInstances] = useState<ClaudeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle URL parameters for direct worktree linking
  useEffect(() => {
    const worktreeParam = searchParams.get('worktree');

    if (!worktreeParam) {
      // No worktree in URL, ensure nothing is selected
      if (selectedWorktreeId) {
        setSelectedWorktreeId(null);
      }
      return;
    }

    if (repositories.length > 0) {
      // Find worktree by ID
      const allWorktrees = repositories.flatMap(repo => repo.worktrees);
      const targetWorktree = allWorktrees.find(w => w.id === worktreeParam);

      if (targetWorktree && selectedWorktreeId !== worktreeParam) {
        // Only select if it's different from current selection
        handleSelectWorktree(targetWorktree.id);
      } else if (!targetWorktree && selectedWorktreeId) {
        // Worktree not found, clear selection
        setSelectedWorktreeId(null);
      }
    }
  }, [repositories, searchParams]);

  const loadData = async () => {
    try {
      console.log('Loading data...');
      const [reposData, instancesData] = await Promise.all([
        api.getRepositories(),
        api.getInstances()
      ]);
      
      console.log('Repositories loaded:', reposData);
      console.log('Instances loaded:', instancesData);
      
      setRepositories(reposData);
      setInstances(instancesData);
      setError(null);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRepository = async (repositoryPath: string) => {
    try {
      await api.addRepository(repositoryPath);
      await loadData();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add repository');
    }
  };

  const handleCreateWorktreeAndStartInstance = async (repositoryId: string, branchName: string) => {
    try {
      const worktree = await api.createWorktree(repositoryId, branchName);
      await api.startInstance(worktree.id);
      await loadData();
      setSelectedWorktreeId(worktree.id);
      setError(null);
      setInstanceError(null);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to create worktree and start instance');
      // Clear error after 10 seconds
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const getPreferredProviderForWorktree = (worktreeId: string): 'claude' | 'codex' => {
    // Check if there was a previous instance for this worktree
    const previousInstance = instances.find(instance => instance.worktreeId === worktreeId);
    if (previousInstance && previousInstance.provider) {
      return previousInstance.provider;
    }
    
    // Default to claude if no previous instance found
    return 'claude';
  };

  const handleStartInstance = async (worktreeId: string, provider?: 'claude' | 'codex') => {
    try {
      // If no provider specified, determine the preferred provider for this worktree
      const selectedProvider = provider || getPreferredProviderForWorktree(worktreeId);
      await api.startInstance(worktreeId, selectedProvider);
      await loadData();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start instance');
    }
  };


  const handleCreateTerminalSession = async (instanceId: string): Promise<string> => {
    try {
      const { sessionId } = await api.createTerminalSession(instanceId);
      setInstanceError(null);
      return sessionId;
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to create terminal session');
      setTimeout(() => setInstanceError(null), 10000);
      throw err;
    }
  };

  const handleCreateDirectoryTerminalSession = async (instanceId: string): Promise<string> => {
    try {
      const { sessionId } = await api.createDirectoryTerminalSession(instanceId);
      setInstanceError(null);
      return sessionId;
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to create directory terminal session');
      setTimeout(() => setInstanceError(null), 10000);
      throw err;
    }
  };

  const handleCloseTerminalSession = async (sessionId: string) => {
    try {
      await api.closeTerminalSession(sessionId);
    } catch (err) {
      console.error('Failed to close terminal session:', err);
    }
  };

  const handleRestartInstance = async (instanceId: string) => {
    try {
      await api.restartInstance(instanceId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to restart instance');
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleStopInstance = async (instanceId: string) => {
    try {
      await api.stopInstance(instanceId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to stop instance');
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleDeleteWorktree = async (worktreeId: string, force: boolean) => {
    try {
      await api.removeWorktree(worktreeId, force);
      await loadData();
      
      // If the deleted worktree was selected, clear the selection
      if (selectedWorktreeId === worktreeId) {
        setSelectedWorktreeId(null);
      }
      
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree');
      throw err; // Re-throw so the modal can handle it
    }
  };

  const handleSelectWorktree = async (worktreeId: string) => {
    setSelectedWorktreeId(worktreeId);

    // Update URL to reflect selected worktree
    setSearchParams({ worktree: worktreeId });

    // Get fresh instance data directly from API to avoid stale state
    try {
      const freshInstances = await api.getInstances();
      const existingInstance = freshInstances.find(instance => instance.worktreeId === worktreeId);

      if (existingInstance) {
        // If instance exists but is stopped/error, restart it
        if (existingInstance.status === 'stopped' || existingInstance.status === 'error') {
          try {
            await handleRestartInstance(existingInstance.id);
            // handleRestartInstance already calls loadData(), so no need to call it again
            return;
          } catch (error) {
            console.error('Failed to restart instance when selecting worktree:', error);
          }
        }
        // If it's running or starting, do nothing - instance is already active
      } else {
        // No instance exists, create a new one
        try {
          await handleStartInstance(worktreeId);
          // handleStartInstance already calls loadData(), so no need to call it again
          return;
        } catch (error) {
          console.error('Failed to start instance when selecting worktree:', error);
        }
      }
    } catch (error) {
      console.error('Failed to get fresh instance data:', error);
    }

    // Only refresh if no instance operations were performed
    await loadData();
  };

  // Get selected worktree and instance
  const selectedWorktree: Worktree | null = repositories
    .flatMap(repo => repo.worktrees)
    .find(worktree => worktree.id === selectedWorktreeId) || null;
  
  const selectedInstance: ClaudeInstance | null = selectedWorktree 
    ? instances.find(instance => instance.worktreeId === selectedWorktree.id) || null
    : null;

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }


  return (
    <div className="container">
      <div className="header">
        <h1
          onClick={() => {
            setSelectedWorktreeId(null);
            setSearchParams({});
          }}
          style={{
            cursor: 'pointer',
            transition: 'color 0.2s ease',
            margin: 0
          }}
          onMouseEnter={(e) => (e.target as HTMLElement).style.color = '#58a6ff'}
          onMouseLeave={(e) => (e.target as HTMLElement).style.color = ''}
        >
          Bob
        </h1>
        <p>Manage multiple Claude Code instances across git repositories and worktrees</p>
      </div>

      <div className="main-layout">
        <RepositoryPanel
          repositories={repositories}
          instances={instances}
          selectedWorktreeId={selectedWorktreeId}
          onAddRepository={handleAddRepository}
          onCreateWorktreeAndStartInstance={handleCreateWorktreeAndStartInstance}
          onSelectWorktree={handleSelectWorktree}
          onDeleteWorktree={handleDeleteWorktree}
        />
        
        <TerminalPanel
          selectedWorktree={selectedWorktree}
          selectedInstance={selectedInstance}
          onCreateTerminalSession={handleCreateTerminalSession}
          onCreateDirectoryTerminalSession={handleCreateDirectoryTerminalSession}
          onCloseTerminalSession={handleCloseTerminalSession}
          onRestartInstance={handleRestartInstance}
          onStopInstance={handleStopInstance}
          onDeleteWorktree={handleDeleteWorktree}
          error={instanceError}
        />
      </div>
    </div>
  );
}

export default App;