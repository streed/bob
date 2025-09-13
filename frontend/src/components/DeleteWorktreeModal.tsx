import React, { useState, useEffect } from 'react';
import { Worktree } from '../types';
import { api } from '../api';

interface DeleteWorktreeModalProps {
  worktree: Worktree;
  onClose: () => void;
  onConfirm: (worktreeId: string, force: boolean) => Promise<void>;
}

interface InstanceInfo {
  id: string;
  status: string;
}

export const DeleteWorktreeModal: React.FC<DeleteWorktreeModalProps> = ({
  worktree,
  onClose,
  onConfirm
}) => {
  const [mergeStatus, setMergeStatus] = useState<{ isMerged: boolean; targetBranch: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deletingStage, setDeletingStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkMergeStatus();
  }, [worktree.id]);

  const checkMergeStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const status = await api.checkWorktreeMergeStatus(worktree.id);
      setMergeStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check merge status');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (force: boolean) => {
    try {
      setDeleting(true);
      setError(null);
      
      if (force) {
        setDeletingStage('Stopping Claude instances...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to show the stage
        setDeletingStage('Removing worktree and cleaning up...');
      } else {
        setDeletingStage('Removing worktree...');
      }
      
      await onConfirm(worktree.id, force);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree');
    } finally {
      setDeleting(false);
      setDeletingStage('');
    }
  };

  const getBranchDisplayName = (branch: string) => {
    return branch.replace(/^refs\/heads\//, '');
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '24px',
        minWidth: '400px',
        maxWidth: '500px',
        color: '#e5e5e5'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#ffffff' }}>
          Delete Worktree: {getBranchDisplayName(worktree.branch)}
        </h3>
        
        <p style={{ margin: '0 0 16px 0', color: '#ccc', fontSize: '14px' }}>
          Path: {worktree.path}
        </p>

        {loading && (
          <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
            Checking merge status...
          </div>
        )}

        {error && (
          <div style={{
            background: '#2d1b1b',
            border: '1px solid #5a1f1f',
            color: '#ff6b6b',
            padding: '12px',
            borderRadius: '4px',
            fontSize: '14px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        {mergeStatus && !loading && (
          <div style={{ marginBottom: '20px' }}>
            {mergeStatus.isMerged ? (
              <div style={{
                background: '#1b2d1b',
                border: '1px solid #2d5a2d',
                color: '#6fbf6f',
                padding: '12px',
                borderRadius: '4px',
                fontSize: '14px',
                marginBottom: '16px'
              }}>
                ✓ Branch has been merged into {mergeStatus.targetBranch}. Safe to delete.
              </div>
            ) : (
              <div style={{
                background: '#2d1b1b',
                border: '1px solid #5a1f1f',
                color: '#ff6b6b',
                padding: '12px',
                borderRadius: '4px',
                fontSize: '14px',
                marginBottom: '16px'
              }}>
                ⚠ Branch has NOT been merged into {mergeStatus.targetBranch}.
                <br />
                <small>Deleting will permanently remove all unmerged changes.</small>
              </div>
            )}
          </div>
        )}

        <div style={{
          background: '#1a1a1a',
          border: '1px solid #444',
          borderRadius: '4px',
          padding: '12px',
          fontSize: '13px',
          color: '#ccc',
          marginBottom: '20px'
        }}>
          <strong>This action will:</strong>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
            <li>Remove the worktree directory from your filesystem</li>
            <li>Stop and clean up all associated Claude instances</li>
            <li>Remove the worktree from the database</li>
            {mergeStatus && !mergeStatus.isMerged && (
              <li style={{ color: '#ff6b6b' }}>
                <strong>Force deletion will also delete the git branch permanently</strong>
              </li>
            )}
          </ul>
          
          {worktree.instances && worktree.instances.length > 0 && (
            <div style={{ marginTop: '12px', padding: '8px', background: '#2d1b1b', borderRadius: '4px' }}>
              <strong style={{ color: '#ff6b6b' }}>⚠ Active instances will be automatically stopped:</strong>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '12px' }}>
                {worktree.instances.map(instance => (
                  <li key={instance.id} style={{ color: '#ffaaaa' }}>
                    {instance.id} ({instance.status})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={deleting}
            style={{
              background: '#666',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: deleting ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            Cancel
          </button>

          {mergeStatus?.isMerged && (
            <button
              onClick={() => handleDelete(false)}
              disabled={deleting || loading}
              style={{
                background: '#28a745',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: (deleting || loading) ? 'not-allowed' : 'pointer',
                fontSize: '14px'
              }}
            >
              {deleting ? (deletingStage || 'Deleting...') : 'Delete (Safe)'}
            </button>
          )}

          <button
            onClick={() => handleDelete(true)}
            disabled={deleting || loading}
            style={{
              background: '#dc3545',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: (deleting || loading) ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            {deleting ? (deletingStage || 'Force Deleting...') : 'Force Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};