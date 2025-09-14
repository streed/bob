import React, { useState } from 'react';
import { useError, AppError } from '../contexts/ErrorContext';

const ErrorDisplay: React.FC = () => {
  const { errors, dismissError } = useError();
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const toggleErrorExpansion = (errorId: string) => {
    const newExpanded = new Set(expandedErrors);
    if (newExpanded.has(errorId)) {
      newExpanded.delete(errorId);
    } else {
      newExpanded.add(errorId);
    }
    setExpandedErrors(newExpanded);
  };

  const getCategoryStyles = (category: AppError['category']) => {
    switch (category) {
      case 'error':
        return {
          background: '#2d1b1b',
          border: '#5a1f1f',
          color: '#ff6b6b',
          icon: '⚠️'
        };
      case 'warning':
        return {
          background: '#2d2a1b',
          border: '#5a501f',
          color: '#ffd93d',
          icon: '⚠️'
        };
      case 'info':
        return {
          background: '#1b1f2d',
          border: '#1f2f5a',
          color: '#5dade2',
          icon: 'ℹ️'
        };
      default:
        return {
          background: '#2d1b1b',
          border: '#5a1f1f',
          color: '#ff6b6b',
          icon: '⚠️'
        };
    }
  };

  const getTypeLabel = (type: AppError['type']) => {
    switch (type) {
      case 'instance':
        return 'Claude Instance';
      case 'repository':
        return 'Repository';
      case 'terminal':
        return 'Terminal';
      case 'git':
        return 'Git';
      case 'network':
        return 'Network';
      case 'system':
        return 'System';
      default:
        return 'Unknown';
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();

    if (diff < 60000) { // Less than 1 minute
      return 'just now';
    } else if (diff < 3600000) { // Less than 1 hour
      return `${Math.floor(diff / 60000)}m ago`;
    } else if (diff < 86400000) { // Less than 1 day
      return `${Math.floor(diff / 3600000)}h ago`;
    } else {
      return timestamp.toLocaleDateString();
    }
  };

  if (errors.length === 0) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: '16px',
      right: '16px',
      maxWidth: '400px',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      {errors.map((error) => {
        const styles = getCategoryStyles(error.category);
        const isExpanded = expandedErrors.has(error.id);

        return (
          <div
            key={error.id}
            style={{
              backgroundColor: styles.background,
              border: `1px solid ${styles.border}`,
              borderRadius: '6px',
              padding: '12px',
              color: styles.color,
              fontSize: '14px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              maxHeight: isExpanded ? 'none' : '120px',
              overflow: isExpanded ? 'visible' : 'hidden',
              transition: 'max-height 0.2s ease-in-out'
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <span style={{ fontSize: '16px' }}>{styles.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: 'bold',
                    fontSize: '13px',
                    color: '#ccc',
                    marginBottom: '2px'
                  }}>
                    {getTypeLabel(error.type)}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#888',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span>{formatTimestamp(error.timestamp)}</span>
                    {error.context && (
                      <span>
                        {error.context.instanceId && `Instance: ${error.context.instanceId.slice(-8)}`}
                        {error.context.repositoryId && `Repo: ${error.context.repositoryId.slice(-8)}`}
                        {error.context.sessionId && `Session: ${error.context.sessionId.slice(-8)}`}
                        {error.context.operation && `Op: ${error.context.operation}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {error.details && (
                  <button
                    onClick={() => toggleErrorExpansion(error.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#888',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '12px',
                      borderRadius: '3px'
                    }}
                    title={isExpanded ? 'Hide details' : 'Show details'}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                )}
                {error.dismissible && (
                  <button
                    onClick={() => dismissError(error.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#888',
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '2px 6px',
                      borderRadius: '3px'
                    }}
                    title="Dismiss"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Message */}
            <div style={{ marginBottom: error.details || error.actions ? '8px' : '0' }}>
              {error.message}
            </div>

            {/* Details (expandable) */}
            {error.details && isExpanded && (
              <div style={{
                marginBottom: error.actions ? '8px' : '0',
                padding: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#ccc'
              }}>
                {error.details}
              </div>
            )}

            {/* Actions */}
            {error.actions && error.actions.length > 0 && (
              <div style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap'
              }}>
                {error.actions.map((action, index) => (
                  <button
                    key={index}
                    onClick={async () => {
                      try {
                        await action.action();
                        // Dismiss error after successful action
                        if (error.dismissible) {
                          dismissError(error.id);
                        }
                      } catch (actionError) {
                        console.error('Error executing action:', actionError);
                      }
                    }}
                    style={{
                      backgroundColor:
                        action.style === 'primary' ? '#007acc' :
                        action.style === 'danger' ? '#dc3545' : '#6c757d',
                      border: 'none',
                      color: '#fff',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'opacity 0.2s'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.opacity = '0.8';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ErrorDisplay;