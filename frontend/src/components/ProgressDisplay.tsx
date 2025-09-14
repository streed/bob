import React from 'react';
import { useProgress, ProgressOperation } from '../contexts/ProgressContext';

const ProgressDisplay: React.FC = () => {
  const { operations, cancelOperation, clearCompleted } = useProgress();

  const runningOperations = operations.filter(op => op.status === 'running');
  const completedOperations = operations.filter(op => op.status === 'completed');
  const errorOperations = operations.filter(op => op.status === 'error');

  const formatDuration = (startTime: Date, endTime?: Date) => {
    const end = endTime || new Date();
    const duration = end.getTime() - startTime.getTime();

    if (duration < 1000) {
      return '<1s';
    } else if (duration < 60000) {
      return `${Math.floor(duration / 1000)}s`;
    } else {
      return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
    }
  };

  const getStatusColor = (status: ProgressOperation['status']) => {
    switch (status) {
      case 'running':
        return '#007acc';
      case 'completed':
        return '#28a745';
      case 'error':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  const getStatusIcon = (status: ProgressOperation['status']) => {
    switch (status) {
      case 'running':
        return '⟳';
      case 'completed':
        return '✓';
      case 'error':
        return '✗';
      default:
        return '?';
    }
  };

  if (operations.length === 0) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      maxWidth: '400px',
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      {/* Running Operations */}
      {runningOperations.map((operation) => (
        <div
          key={operation.id}
          style={{
            backgroundColor: '#1a1a1a',
            border: `1px solid ${getStatusColor(operation.status)}`,
            borderRadius: '6px',
            padding: '12px',
            color: '#fff',
            fontSize: '13px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            minWidth: '300px'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  color: getStatusColor(operation.status),
                  fontSize: '14px',
                  animation: operation.status === 'running' ? 'spin 1s linear infinite' : 'none'
                }}
              >
                {getStatusIcon(operation.status)}
              </span>
              <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                {operation.title}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: '#888' }}>
                {formatDuration(operation.startTime)}
              </span>
              {operation.canCancel && (
                <button
                  onClick={() => cancelOperation(operation.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '2px 6px',
                    borderRadius: '3px'
                  }}
                  title="Cancel"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          {operation.description && (
            <div style={{ marginBottom: '8px', color: '#ccc', fontSize: '12px' }}>
              {operation.description}
            </div>
          )}

          {/* Progress Bar */}
          <div style={{
            width: '100%',
            height: '6px',
            backgroundColor: '#333',
            borderRadius: '3px',
            overflow: 'hidden'
          }}>
            {operation.progress >= 0 ? (
              <div
                style={{
                  width: `${operation.progress}%`,
                  height: '100%',
                  backgroundColor: getStatusColor(operation.status),
                  transition: 'width 0.3s ease-in-out'
                }}
              />
            ) : (
              // Indeterminate progress
              <div
                style={{
                  width: '30%',
                  height: '100%',
                  backgroundColor: getStatusColor(operation.status),
                  animation: 'indeterminate 1.5s ease-in-out infinite'
                }}
              />
            )}
          </div>

          {/* Progress Text */}
          {operation.progress >= 0 && (
            <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '11px', color: '#888' }}>
              {operation.progress}%
            </div>
          )}
        </div>
      ))}

      {/* Completed/Error Summary */}
      {(completedOperations.length > 0 || errorOperations.length > 0) && (
        <div
          style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: '6px',
            padding: '8px 12px',
            color: '#fff',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {completedOperations.length > 0 && (
              <span style={{ color: '#28a745' }}>
                ✓ {completedOperations.length} completed
              </span>
            )}
            {errorOperations.length > 0 && (
              <span style={{ color: '#dc3545' }}>
                ✗ {errorOperations.length} failed
              </span>
            )}
          </div>
          <button
            onClick={clearCompleted}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '3px'
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Add CSS animations */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes indeterminate {
          0% { margin-left: -30%; }
          50% { margin-left: 100%; }
          100% { margin-left: 100%; }
        }
      `}</style>
    </div>
  );
};

export default ProgressDisplay;