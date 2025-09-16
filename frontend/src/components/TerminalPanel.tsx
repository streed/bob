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
  onDeleteWorktree: (worktreeId: string, force: boolean) => Promise<void>;
  error: string | null;
  isLeftPanelCollapsed: boolean;
}

// Comment types
interface DiffComment {
  id: string;
  file: string;
  line: number;
  type: 'suggestion' | 'warning' | 'error' | 'user';
  message: string;
  severity: 'low' | 'medium' | 'high';
  isAI?: boolean;
  userReply?: string;
  isDismissed?: boolean;
}

// Inline comment component
const InlineComment: React.FC<{
  comment: DiffComment;
  onReply?: (commentId: string, reply: string) => void;
  onDismiss?: (commentId: string) => void;
}> = ({ comment, onReply, onDismiss }) => {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState(comment.userReply || '');

  const getIconAndColor = () => {
    switch (comment.type) {
      case 'error':
        return { icon: '❌', color: '#f85149', bgColor: '#67060c1a' };
      case 'warning':
        return { icon: '⚠️', color: '#f59e0b', bgColor: '#92400e1a' };
      case 'suggestion':
        return { icon: '💡', color: '#58a6ff', bgColor: '#0969da1a' };
      case 'user':
        return { icon: '💬', color: '#d2a8ff', bgColor: '#6f42c11a' };
      default:
        return { icon: '📝', color: '#8b949e', bgColor: '#21262d' };
    }
  };

  const { icon, color, bgColor } = getIconAndColor();

  return (
    <div style={{
      backgroundColor: bgColor,
      border: `1px solid ${color}33`,
      borderRadius: '6px',
      margin: '4px 0',
      padding: '8px',
      fontSize: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ color, fontWeight: 'bold', textTransform: 'capitalize' }}>
              {comment.type} {comment.isAI && '(AI)'}
            </span>
            <span style={{ color: '#8b949e', fontSize: '10px' }}>
              Line {comment.line}
            </span>
            {comment.severity && (
              <span style={{
                backgroundColor: comment.severity === 'high' ? '#f85149' :
                                comment.severity === 'medium' ? '#f59e0b' : '#3fb950',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}>
                {comment.severity}
              </span>
            )}
          </div>
          <div style={{ color: '#e6edf3', lineHeight: '1.4', marginBottom: '8px' }}>
            {comment.message}
          </div>

          {comment.userReply && (
            <div style={{
              backgroundColor: '#21262d',
              border: '1px solid #30363d',
              borderRadius: '4px',
              padding: '6px',
              marginBottom: '8px'
            }}>
              <div style={{ color: '#8b949e', fontSize: '10px', marginBottom: '2px' }}>Your reply:</div>
              <div style={{ color: '#e6edf3', fontSize: '11px' }}>{comment.userReply}</div>
            </div>
          )}

          {showReply && (
            <div style={{ marginTop: '8px' }}>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Add your reply or additional context..."
                style={{
                  width: '100%',
                  minHeight: '60px',
                  backgroundColor: '#21262d',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  color: '#e6edf3',
                  padding: '6px',
                  fontSize: '11px',
                  resize: 'vertical'
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  onClick={() => {
                    if (onReply && replyText.trim()) {
                      onReply(comment.id, replyText.trim());
                      setShowReply(false);
                    }
                  }}
                  style={{
                    backgroundColor: '#238636',
                    border: 'none',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  Save Reply
                </button>
                <button
                  onClick={() => setShowReply(false)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid #30363d',
                    color: '#8b949e',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {!showReply && (
              <button
                onClick={() => setShowReply(true)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #30363d',
                  color: '#8b949e',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                Reply
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(comment.id)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #30363d',
                  color: '#8b949e',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Enhanced unified diff view component with comments
const UnifiedDiffView: React.FC<{
  gitDiff: string;
  comments?: DiffComment[];
  onAddComment?: (file: string, line: number, message: string) => void;
  onReplyToComment?: (commentId: string, reply: string) => void;
  onDismissComment?: (commentId: string) => void;
}> = ({ gitDiff, comments = [], onAddComment, onReplyToComment, onDismissComment }) => {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [showAddComment, setShowAddComment] = useState<{ file: string; line: number } | null>(null);
  const [newCommentText, setNewCommentText] = useState('');

  const parseLineNumber = (line: string): number | null => {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      return match ? parseInt(match[1]) : null;
    }
    return null;
  };

  const getActualLineNumber = (lineIndex: number, lines: string[]): number | null => {
    let currentLineNumber = 1;

    for (let i = 0; i <= lineIndex; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const newLineNumber = parseLineNumber(line);
        if (newLineNumber) currentLineNumber = newLineNumber;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        if (i === lineIndex) return currentLineNumber;
        currentLineNumber++;
      } else if (!line.startsWith('-') && !line.startsWith('+++') && !line.startsWith('---') &&
                 !line.startsWith('new file') && !line.startsWith('index') && !line.startsWith('diff --git')) {
        if (i === lineIndex) return currentLineNumber;
        currentLineNumber++;
      }
    }
    return null;
  };

  const lines = gitDiff.split('\n');

  // Pre-process lines to avoid state updates during render
  const processedLines = React.useMemo(() => {
    let currentFile = '';
    return lines.map((line, index) => {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2];
        }
      }
      return {
        line,
        index,
        currentFile,
        actualLineNumber: getActualLineNumber(index, lines)
      };
    });
  }, [gitDiff]);

  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: '6px',
      overflow: 'hidden',
      fontSize: '12px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    }}>
      {processedLines.map(({ line, index, currentFile, actualLineNumber }) => {
        let lineStyle: React.CSSProperties = {
          padding: '0 8px',
          margin: 0,
          minHeight: '20px',
          lineHeight: '20px',
          whiteSpace: 'pre',
          position: 'relative'
        };

        const lineComments = comments.filter(c =>
          c.file === currentFile && c.line === actualLineNumber
        );

        if (line.startsWith('diff --git')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#21262d',
            color: '#f0f6fc',
            fontWeight: 'bold',
            borderBottom: '1px solid #30363d'
          };
        } else if (line.startsWith('@@')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#0969da1a',
            color: '#58a6ff'
          };
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#0361491a',
            color: '#3fb950'
          };
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#67060c1a',
            color: '#f85149'
          };
        } else if (line.startsWith('+++') || line.startsWith('---')) {
          lineStyle = {
            ...lineStyle,
            color: '#8b949e',
            fontWeight: 'bold'
          };
        } else if (line.startsWith('new file mode') || line.startsWith('index')) {
          lineStyle = {
            ...lineStyle,
            color: '#8b949e'
          };
        } else {
          lineStyle = {
            ...lineStyle,
            color: '#e6edf3'
          };
        }

        return (
          <div key={index}>
            <div
              style={{
                ...lineStyle,
                display: 'flex',
                alignItems: 'center'
              }}
              onMouseEnter={() => setHoveredLine(index)}
              onMouseLeave={() => setHoveredLine(null)}
            >
              <span style={{ flex: 1 }}>{line || ' '}</span>

              {/* Add comment button for relevant lines */}
              {actualLineNumber && currentFile && onAddComment &&
               (line.startsWith('+') || (!line.startsWith('-') && !line.startsWith('@@'))) &&
               hoveredLine === index && (
                <button
                  onClick={() => setShowAddComment({ file: currentFile, line: actualLineNumber })}
                  style={{
                    backgroundColor: '#238636',
                    border: 'none',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    marginLeft: '8px'
                  }}
                >
                  💬
                </button>
              )}
            </div>

            {/* Show add comment form */}
            {showAddComment && showAddComment.file === currentFile &&
             showAddComment.line === actualLineNumber && (
              <div style={{
                backgroundColor: '#21262d',
                border: '1px solid #30363d',
                borderRadius: '6px',
                margin: '4px 8px',
                padding: '8px'
              }}>
                <textarea
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Add your comment about this line..."
                  style={{
                    width: '100%',
                    minHeight: '60px',
                    backgroundColor: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '4px',
                    color: '#e6edf3',
                    padding: '6px',
                    fontSize: '11px',
                    resize: 'vertical'
                  }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button
                    onClick={() => {
                      if (onAddComment && newCommentText.trim()) {
                        onAddComment(showAddComment.file, showAddComment.line, newCommentText.trim());
                        setNewCommentText('');
                        setShowAddComment(null);
                      }
                    }}
                    style={{
                      backgroundColor: '#238636',
                      border: 'none',
                      color: '#fff',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Add Comment
                  </button>
                  <button
                    onClick={() => {
                      setShowAddComment(null);
                      setNewCommentText('');
                    }}
                    style={{
                      backgroundColor: 'transparent',
                      border: '1px solid #30363d',
                      color: '#8b949e',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Show comments for this line */}
            {lineComments.length > 0 && (
              <div style={{ margin: '0 8px' }}>
                {lineComments.map(comment => (
                  <InlineComment
                    key={comment.id}
                    comment={comment}
                    onReply={onReplyToComment}
                    onDismiss={onDismissComment}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Split diff view component
const SplitDiffView: React.FC<{ gitDiff: string }> = ({ gitDiff }) => {
  const parsedDiff = parseDiffForSplitView(gitDiff);

  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: '6px',
      overflow: 'hidden',
      fontSize: '12px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    }}>
      {parsedDiff.map((file, fileIndex) => (
        <div key={fileIndex}>
          {/* File header */}
          <div style={{
            backgroundColor: '#21262d',
            color: '#f0f6fc',
            fontWeight: 'bold',
            padding: '8px',
            borderBottom: '1px solid #30363d'
          }}>
            {file.fileName}
          </div>

          {/* Split view table */}
          <div style={{ display: 'flex', width: '100%' }}>
            {/* Left side (old/removed) */}
            <div style={{ flex: 1, borderRight: '1px solid #30363d' }}>
              {file.chunks.map((chunk, chunkIndex) => (
                <div key={`left-${chunkIndex}`}>
                  {chunk.oldLines.map((line, lineIndex) => (
                    <div key={lineIndex} style={{
                      padding: '0 8px',
                      minHeight: '20px',
                      lineHeight: '20px',
                      backgroundColor: line.type === 'removed' ? '#67060c1a' : 'transparent',
                      color: line.type === 'removed' ? '#f85149' : '#8b949e'
                    }}>
                      {line.content || ' '}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Right side (new/added) */}
            <div style={{ flex: 1 }}>
              {file.chunks.map((chunk, chunkIndex) => (
                <div key={`right-${chunkIndex}`}>
                  {chunk.newLines.map((line, lineIndex) => (
                    <div key={lineIndex} style={{
                      padding: '0 8px',
                      minHeight: '20px',
                      lineHeight: '20px',
                      backgroundColor: line.type === 'added' ? '#0361491a' : 'transparent',
                      color: line.type === 'added' ? '#3fb950' : '#8b949e'
                    }}>
                      {line.content || ' '}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Helper function to parse diff for split view
const parseDiffForSplitView = (gitDiff: string) => {
  const lines = gitDiff.split('\n');
  const files: Array<{
    fileName: string;
    chunks: Array<{
      oldLines: Array<{ content: string; type: 'context' | 'removed' | 'empty' }>;
      newLines: Array<{ content: string; type: 'context' | 'added' | 'empty' }>;
    }>;
  }> = [];

  let currentFile: typeof files[0] | null = null;
  let currentChunk: typeof files[0]['chunks'][0] | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      // Start new file
      const fileName = line.split(' b/')[1] || line.split(' ')[3];
      currentFile = { fileName, chunks: [] };
      files.push(currentFile);
    } else if (line.startsWith('@@') && currentFile) {
      // Start new chunk
      currentChunk = { oldLines: [], newLines: [] };
      currentFile.chunks.push(currentChunk);
    } else if (currentChunk && currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Added line - only in new/right side
        currentChunk.oldLines.push({ content: '', type: 'empty' });
        currentChunk.newLines.push({ content: line.slice(1), type: 'added' });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Removed line - only in old/left side
        currentChunk.oldLines.push({ content: line.slice(1), type: 'removed' });
        currentChunk.newLines.push({ content: '', type: 'empty' });
      } else if (!line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('new file') && !line.startsWith('index')) {
        // Context line - in both sides
        const content = line.startsWith(' ') ? line.slice(1) : line;
        if (content.trim()) {
          currentChunk.oldLines.push({ content, type: 'context' });
          currentChunk.newLines.push({ content, type: 'context' });
        }
      }
    }
  }

  return files;
};

// System Status Dashboard Component
const SystemStatusDashboard: React.FC = () => {
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const loadSystemStatus = async () => {
      try {
        if (!loading) setIsUpdating(true);
        const status = await api.getSystemStatus();
        setSystemStatus(status);
      } catch (error) {
        console.error('Failed to load system status:', error);
      } finally {
        setLoading(false);
        setIsUpdating(false);
      }
    };

    loadSystemStatus();
    const interval = setInterval(loadSystemStatus, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888'
      }}>
        Loading system status...
      </div>
    );
  }

  if (!systemStatus) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888'
      }}>
        Failed to load system status
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return '#3fb950';
      case 'not_authenticated': return '#f59e0b';
      case 'not_available': return '#f85149';
      default: return '#8b949e';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available': return '✅';
      case 'not_authenticated': return '⚠️';
      case 'not_available': return '❌';
      default: return '❓';
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div style={{
      flex: 1,
      padding: '24px',
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <h2 style={{ color: '#fff', margin: 0, fontSize: '24px' }}>System Status</h2>
          {isUpdating && (
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#3fb950',
              borderRadius: '50%',
              animation: 'pulse 1.5s ease-in-out infinite'
            }} />
          )}
        </div>
        <p style={{ color: '#888', margin: 0, fontSize: '14px' }}>
          Monitor Bob system health and dependency status • Updates every 10 seconds
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 10px rgba(63, 185, 80, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0);
          }
        }
      `}</style>

      {/* System Dependencies */}
      <div style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '24px',
        marginBottom: '24px'
      }}>
        <h3 style={{ color: '#fff', margin: 0, marginBottom: '20px', fontSize: '18px' }}>System Dependencies</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Claude CLI Status */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px',
            backgroundColor: '#0d1117',
            borderRadius: '6px',
            border: '1px solid #21262d'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '20px' }}>{getStatusIcon(systemStatus.claude.status)}</span>
              <div>
                <div style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>Claude CLI</div>
                <div style={{ color: '#888', fontSize: '12px' }}>
                  {systemStatus.claude.status === 'available' ? 'Ready for AI-powered features' : 'Required for git analysis and PR generation'}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                color: getStatusColor(systemStatus.claude.status),
                fontSize: '12px',
                fontWeight: 'bold',
                marginBottom: '2px'
              }}>
                {systemStatus.claude.status.replace('_', ' ').toUpperCase()}
              </div>
              {systemStatus.claude.version && (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  {systemStatus.claude.version}
                </div>
              )}
            </div>
          </div>

          {/* GitHub CLI Status */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px',
            backgroundColor: '#0d1117',
            borderRadius: '6px',
            border: '1px solid #21262d'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '20px' }}>{getStatusIcon(systemStatus.github.status)}</span>
              <div>
                <div style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>GitHub CLI</div>
                <div style={{ color: '#888', fontSize: '12px' }}>
                  {systemStatus.github.status === 'available' ? 'Ready for PR operations' :
                   systemStatus.github.status === 'not_authenticated' ? 'Run: gh auth login' :
                   'Required for PR creation and updates'}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                color: getStatusColor(systemStatus.github.status),
                fontSize: '12px',
                fontWeight: 'bold',
                marginBottom: '2px'
              }}>
                {systemStatus.github.status.replace('_', ' ').toUpperCase()}
              </div>
              {systemStatus.github.user && (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  @{systemStatus.github.user}
                </div>
              )}
              {systemStatus.github.version && (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  {systemStatus.github.version.split(' ')[0]}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>REPOSITORIES</div>
          <div style={{
            color: '#58a6ff',
            fontSize: '28px',
            fontWeight: 'bold'
          }}>
            {systemStatus.metrics.repositories}
          </div>
        </div>

        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>WORKTREES</div>
          <div style={{
            color: '#3fb950',
            fontSize: '28px',
            fontWeight: 'bold'
          }}>
            {systemStatus.metrics.worktrees}
          </div>
        </div>

        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>ACTIVE INSTANCES</div>
          <div style={{
            color: '#f59e0b',
            fontSize: '28px',
            fontWeight: 'bold'
          }}>
            {systemStatus.metrics.activeInstances}
          </div>
          <div style={{ color: '#666', fontSize: '10px', marginTop: '4px' }}>
            of {systemStatus.metrics.totalInstances} total
          </div>
        </div>
      </div>

      {/* Server Info */}
      <div style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '24px'
      }}>
        <h3 style={{ color: '#fff', margin: 0, marginBottom: '16px', fontSize: '18px' }}>Server Information</h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '20px'
        }}>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>UPTIME</div>
            <div style={{ color: '#d2a8ff', fontSize: '20px', fontWeight: 'bold' }}>
              {formatUptime(systemStatus.server.uptime)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>MEMORY USAGE</div>
            <div style={{ color: '#f85149', fontSize: '20px', fontWeight: 'bold' }}>
              {formatMemory(systemStatus.server.memory.heapUsed)}
            </div>
            <div style={{ color: '#666', fontSize: '10px' }}>
              / {formatMemory(systemStatus.server.memory.heapTotal)} heap
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>NODE VERSION</div>
            <div style={{ color: '#8b949e', fontSize: '20px', fontWeight: 'bold' }}>
              {systemStatus.server.nodeVersion}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  selectedWorktree,
  selectedInstance,
  onCreateTerminalSession,
  onCreateDirectoryTerminalSession,
  onCloseTerminalSession,
  onRestartInstance,
  onStopInstance,
  onDeleteWorktree,
  error,
  isLeftPanelCollapsed
}) => {
  // Suppress TypeScript warning for unused parameter
  // This parameter is part of the interface for future UI responsiveness features
  void isLeftPanelCollapsed;
  
  const [claudeTerminalSessionId, setClaudeTerminalSessionId] = useState<string | null>(null);
  const [directoryTerminalSessionId, setDirectoryTerminalSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'claude' | 'directory' | 'git'>('claude');
  const [isCreatingClaudeSession, setIsCreatingClaudeSession] = useState(false);
  const [isCreatingDirectorySession, setIsCreatingDirectorySession] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const lastAutoConnectInstance = useRef<string>('');

  // Git state
  const [gitDiff, setGitDiff] = useState<string>('');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState<string>('');
  const [isGeneratingCommit, setIsGeneratingCommit] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isUpdatingPR, setIsUpdatingPR] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [showDenyConfirmation, setShowDenyConfirmation] = useState(false);
  const [deleteWorktreeOnDeny, setDeleteWorktreeOnDeny] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<'unified' | 'split'>('unified');

  // Analysis and comments state
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string>('');
  const [currentAnalysisId, setCurrentAnalysisId] = useState<string | null>(null);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);

  useEffect(() => {
    // Clear frontend terminal state when switching instances (but keep backend sessions alive)
    console.log(`Switching to instance: ${selectedInstance?.id}, clearing session state`);
    setClaudeTerminalSessionId(null);
    setDirectoryTerminalSessionId(null);
    // Clear git state when switching
    setGitDiff('');
    setGitCommitMessage('');
    // Clear analysis state when switching
    setComments([]);
    setAnalysisComplete(false);
    setAnalysisSummary('');
    setCurrentAnalysisId(null);
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

  // Git operations
  const loadGitDiff = async () => {
    if (!selectedWorktree) return;

    setGitLoading(true);
    try {
      const diff = await api.getGitDiff(selectedWorktree.id);
      setGitDiff(diff);

      // Load existing analysis and comments for current git state
      try {
        const analysisData = await api.getAnalysis(selectedWorktree.id);
        if (analysisData.analysis) {
          setAnalysisComplete(true);
          setAnalysisSummary(analysisData.analysis.summary);
          setCurrentAnalysisId(analysisData.analysis.id);

          // Convert backend format to frontend format
          const frontendComments: DiffComment[] = analysisData.comments.map(comment => ({
            id: comment.id,
            file: comment.file,
            line: comment.line,
            type: comment.type,
            message: comment.message,
            severity: comment.severity,
            isAI: comment.isAI,
            userReply: comment.userReply
          }));
          setComments(frontendComments);
        } else {
          // No existing analysis
          setAnalysisComplete(false);
          setAnalysisSummary('');
          setCurrentAnalysisId(null);
          setComments([]);
        }
      } catch (analysisError) {
        console.error('Failed to load existing analysis:', analysisError);
        // Continue without analysis if it fails
        setAnalysisComplete(false);
        setAnalysisSummary('');
        setCurrentAnalysisId(null);
        setComments([]);
      }
    } catch (error) {
      console.error('Failed to load git diff:', error);
      setGitDiff('');
    } finally {
      setGitLoading(false);
    }
  };

  const handleAcceptChanges = async () => {
    if (!selectedWorktree) return;

    setIsGeneratingCommit(true);
    try {
      // Generate commit message using Claude, including comments context
      const result = await api.generateCommitMessage(selectedWorktree.id, comments);
      setGitCommitMessage(result.commitMessage);

      // Auto-commit the changes
      setIsCommitting(true);
      await api.commitChanges(selectedWorktree.id, result.commitMessage);

      // Refresh git diff (should be empty now)
      await loadGitDiff();

      // Clear comments since changes were accepted
      setComments([]);
      setAnalysisComplete(false);
      setAnalysisSummary('');
      setCurrentAnalysisId(null);

      // Smart PR management: create new PR or update existing one
      try {
        // First try to update existing PR
        try {
          const updateResult = await api.updatePullRequest(selectedWorktree.id);
          console.log('Updated existing PR:', updateResult.title);
        } catch (updateError: any) {
          // No existing PR found, create a new one
          if (updateError.message?.includes('No pull request found')) {
            const createResult = await api.createPullRequest(selectedWorktree.id);
            console.log('Created new PR:', createResult.title);
          } else {
            // Update failed for other reasons, try creating
            await api.createPullRequest(selectedWorktree.id);
          }
        }
      } catch (prError) {
        console.warn('Failed to manage pull request:', prError);
      }

    } catch (error) {
      console.error('Failed to accept changes:', error);
    } finally {
      setIsGeneratingCommit(false);
      setIsCommitting(false);
    }
  };

  const handleUpdatePR = async () => {
    if (!selectedWorktree) return;

    setIsUpdatingPR(true);
    try {
      const result = await api.updatePullRequest(selectedWorktree.id);
      console.log('PR updated successfully:', result.title);
    } catch (error: any) {
      if (error.message?.includes('No pull request found')) {
        // No existing PR, create one
        try {
          const createResult = await api.createPullRequest(selectedWorktree.id);
          console.log('Created new PR since none existed:', createResult.title);
        } catch (createError) {
          console.error('Failed to create PR:', createError);
        }
      } else {
        console.error('Failed to update PR:', error);
      }
    } finally {
      setIsUpdatingPR(false);
    }
  };

  const handleDenyChanges = () => {
    setShowDenyConfirmation(true);
  };

  const confirmDenyChanges = async () => {
    if (!selectedWorktree) return;

    setIsReverting(true);
    try {
      if (deleteWorktreeOnDeny) {
        // Comprehensive cleanup: stop instance, revert changes, and delete worktree

        // 1. Stop the Claude instance if running
        if (selectedInstance) {
          console.log('Stopping instance before worktree deletion...');
          await onStopInstance(selectedInstance.id);
        }

        // 2. Close any terminal sessions
        if (claudeTerminalSessionId) {
          onCloseTerminalSession(claudeTerminalSessionId);
          setClaudeTerminalSessionId(null);
        }
        if (directoryTerminalSessionId) {
          onCloseTerminalSession(directoryTerminalSessionId);
          setDirectoryTerminalSessionId(null);
        }

        // 3. Delete the worktree entirely (this also reverts changes)
        console.log('Deleting worktree...');
        await onDeleteWorktree(selectedWorktree.id, false);

        // Note: onDeleteWorktree should handle clearing the selection and refreshing data
      } else {
        // Just revert changes, keep worktree
        await api.revertChanges(selectedWorktree.id);
        await loadGitDiff(); // Should be empty now

        // Clear comments since changes were reverted
        setComments([]);
        setAnalysisComplete(false);
        setAnalysisSummary('');
        setCurrentAnalysisId(null);
      }

    } catch (error) {
      console.error('Failed to deny changes:', error);
    } finally {
      setIsReverting(false);
      setShowDenyConfirmation(false);
      setDeleteWorktreeOnDeny(false); // Reset checkbox state
    }
  };

  // Analysis and comment operations
  const handleAnalyzeDiff = async () => {
    if (!selectedWorktree) return;

    setIsAnalyzing(true);
    try {
      const result = await api.analyzeDiff(selectedWorktree.id);

      // Set the analysis ID from the database
      setCurrentAnalysisId(result.analysis.analysisId);

      // Convert API response to DiffComment format
      const newComments: DiffComment[] = result.analysis.comments.map((comment, index) => ({
        id: `ai-${Date.now()}-${index}`,
        file: comment.file,
        line: comment.line,
        type: comment.type,
        message: comment.message,
        severity: comment.severity,
        isAI: true
      }));

      setComments(newComments);
      setAnalysisSummary(result.analysis.summary);
      setAnalysisComplete(true);
    } catch (error) {
      console.error('Failed to analyze diff:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddComment = async (file: string, line: number, message: string) => {
    if (!selectedWorktree || !currentAnalysisId) return;

    try {
      const newComment = await api.addComment(selectedWorktree.id, {
        analysisId: currentAnalysisId,
        file,
        line,
        message
      });

      const frontendComment: DiffComment = {
        id: newComment.id,
        file: newComment.file,
        line: newComment.line,
        type: newComment.type,
        message: newComment.message,
        severity: newComment.severity,
        isAI: newComment.isAI
      };

      setComments(prev => [...prev, frontendComment]);
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  };

  const handleApplyFixes = async () => {
    if (!selectedWorktree) return;

    setIsApplyingFixes(true);
    try {
      const result = await api.applyCodeFixes(selectedWorktree.id);

      if (result.success) {
        // Success message
        console.log(`Applied ${result.fixesApplied} fixes to ${result.filesModified || 0} files`);

        // Refresh the git diff to show the applied changes
        try {
          const diff = await api.getGitDiff(selectedWorktree.id);
          setGitDiff(diff);
        } catch (error) {
          console.error('Failed to refresh git diff:', error);
        }

        // Optionally clear comments since fixes have been applied
        if (result.fixesApplied > 0) {
          setComments([]);
          setAnalysisComplete(false);
          setCurrentAnalysisId(null);
        }

        // You could show a toast notification here
        alert(`Successfully applied ${result.fixesApplied} code fixes!`);
      } else {
        console.error('Failed to apply fixes:', result.error);
        alert(`Failed to apply fixes: ${result.error}`);
      }
    } catch (error) {
      console.error('Error applying fixes:', error);
      alert('Failed to apply code fixes. Please try again.');
    } finally {
      setIsApplyingFixes(false);
    }
  };

  const handleReplyToComment = async (commentId: string, reply: string) => {
    if (!selectedWorktree) return;

    try {
      await api.updateComment(selectedWorktree.id, commentId, { userReply: reply });

      setComments(prev => prev.map(comment =>
        comment.id === commentId
          ? { ...comment, userReply: reply }
          : comment
      ));
    } catch (error) {
      console.error('Failed to reply to comment:', error);
    }
  };

  const handleDismissComment = async (commentId: string) => {
    if (!selectedWorktree) return;

    try {
      await api.updateComment(selectedWorktree.id, commentId, { isDismissed: true });

      setComments(prev => prev.filter(comment => comment.id !== commentId));
    } catch (error) {
      console.error('Failed to dismiss comment:', error);
    }
  };


  // Load git diff when switching to git tab
  useEffect(() => {
    if (activeTab === 'git' && selectedWorktree) {
      loadGitDiff();
    }
  }, [activeTab, selectedWorktree?.id]);

  if (!selectedWorktree) {
    return (
      <div className="right-panel">
        <div className="panel-header">
          <h3 style={{ margin: 0, color: '#ffffff' }}>Dashboard</h3>
        </div>
        <SystemStatusDashboard />
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
        <button
          onClick={() => {
            setActiveTab('git');
          }}
          style={{
            background: activeTab === 'git' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'git' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Git {gitDiff && gitDiff.trim() && '●'}
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

        {/* Git Tab */}
        <div style={{
          display: activeTab === 'git' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          padding: '16px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid #444',
            paddingBottom: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h4 style={{ color: '#fff', margin: 0 }}>Git Changes</h4>
              {gitDiff && gitDiff.trim() && (
                <div style={{
                  display: 'flex',
                  backgroundColor: '#21262d',
                  borderRadius: '6px',
                  border: '1px solid #30363d',
                  overflow: 'hidden'
                }}>
                  <button
                    onClick={() => setDiffViewMode('unified')}
                    style={{
                      backgroundColor: diffViewMode === 'unified' ? '#0969da' : 'transparent',
                      border: 'none',
                      color: diffViewMode === 'unified' ? '#fff' : '#8b949e',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: diffViewMode === 'unified' ? 'bold' : 'normal'
                    }}
                  >
                    Unified
                  </button>
                  <button
                    onClick={() => setDiffViewMode('split')}
                    style={{
                      backgroundColor: diffViewMode === 'split' ? '#0969da' : 'transparent',
                      border: 'none',
                      color: diffViewMode === 'split' ? '#fff' : '#8b949e',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: diffViewMode === 'split' ? 'bold' : 'normal'
                    }}
                  >
                    Split
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {gitDiff && gitDiff.trim() ? (
                <>
                  <button
                    onClick={handleAcceptChanges}
                    disabled={isGeneratingCommit || isCommitting}
                    style={{
                      backgroundColor: '#28a745',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isGeneratingCommit || isCommitting ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isGeneratingCommit || isCommitting ? 0.6 : 1
                    }}
                  >
                    {isGeneratingCommit ? (
                      <>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Generating...
                      </>
                    ) : isCommitting ? (
                      <>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Committing...
                      </>
                    ) : (
                      '✅ Accept Changes'
                    )}
                  </button>
                  <button
                    onClick={handleAnalyzeDiff}
                    disabled={isAnalyzing}
                    style={{
                      backgroundColor: '#8b5cf6',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isAnalyzing ? 0.6 : 1,
                      marginLeft: '8px'
                    }}
                  >
                    {isAnalyzing ? (
                      <>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Analyzing...
                      </>
                    ) : (
                      '🔍 Analyze Code'
                    )}
                  </button>
                  {/* Apply Fixes button - only show when there are non-dismissed comments */}
                  {comments.some(comment => !comment.isDismissed) && (
                    <button
                      onClick={handleApplyFixes}
                      disabled={isApplyingFixes}
                      style={{
                        backgroundColor: '#28a745',
                        border: 'none',
                        color: '#fff',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: isApplyingFixes ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        opacity: isApplyingFixes ? 0.6 : 1,
                        marginLeft: '8px'
                      }}
                    >
                      {isApplyingFixes ? (
                        <>
                          <div style={{
                            display: 'inline-block',
                            width: '12px',
                            height: '12px',
                            marginRight: '6px',
                            border: '2px solid transparent',
                            borderTop: '2px solid #fff',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                          }} />
                          Applying...
                        </>
                      ) : (
                        '🔧 Apply Fixes'
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleUpdatePR}
                    disabled={isUpdatingPR}
                    style={{
                      backgroundColor: '#007acc',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isUpdatingPR ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      opacity: isUpdatingPR ? 0.6 : 1,
                      marginLeft: '8px'
                    }}
                  >
                    {isUpdatingPR ? (
                      <>
                        <div style={{
                          display: 'inline-block',
                          width: '12px',
                          height: '12px',
                          marginRight: '6px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Updating...
                      </>
                    ) : (
                      '🔄 Update PR'
                    )}
                  </button>
                  <button
                    onClick={handleDenyChanges}
                    disabled={isReverting}
                    style={{
                      backgroundColor: '#dc3545',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isReverting ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      opacity: isReverting ? 0.6 : 1,
                      marginLeft: '8px'
                    }}
                  >
                    ❌ Deny Changes
                  </button>
                </>
              ) : (
                <button
                  onClick={loadGitDiff}
                  disabled={gitLoading}
                  style={{
                    backgroundColor: '#007acc',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: gitLoading ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    opacity: gitLoading ? 0.6 : 1
                  }}
                >
                  {gitLoading ? 'Loading...' : '🔄 Refresh'}
                </button>
              )}
            </div>
          </div>

          {gitLoading ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#888'
            }}>
              Loading git changes...
            </div>
          ) : gitDiff && gitDiff.trim() ? (
            <div style={{ flex: 1, overflow: 'auto' }}>
              {/* Analysis Summary */}
              {analysisComplete && analysisSummary && (
                <div style={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '16px'
                }}>
                  <h5 style={{ color: '#fff', marginBottom: '8px', fontSize: '14px' }}>
                    🤖 AI Analysis Summary
                  </h5>
                  <p style={{
                    color: '#e6edf3',
                    fontSize: '12px',
                    lineHeight: '1.4',
                    margin: 0
                  }}>
                    {analysisSummary}
                  </p>
                  {comments.length > 0 && (
                    <p style={{
                      color: '#8b949e',
                      fontSize: '11px',
                      margin: '8px 0 0 0'
                    }}>
                      Found {comments.length} comment{comments.length !== 1 ? 's' : ''} on the code
                    </p>
                  )}
                </div>
              )}

              {diffViewMode === 'unified' ? (
                <UnifiedDiffView
                  gitDiff={gitDiff}
                  comments={comments}
                  onAddComment={handleAddComment}
                  onReplyToComment={handleReplyToComment}
                  onDismissComment={handleDismissComment}
                />
              ) : (
                <SplitDiffView gitDiff={gitDiff} />
              )}
              {gitCommitMessage && (
                <div style={{ marginTop: '16px' }}>
                  <h5 style={{ color: '#fff', marginBottom: '8px' }}>Generated Commit Message:</h5>
                  <pre style={{
                    background: '#2d3748',
                    border: '1px solid #4a5568',
                    borderRadius: '4px',
                    padding: '8px',
                    color: '#a0aec0',
                    fontSize: '12px',
                    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                    whiteSpace: 'pre-wrap',
                    margin: 0
                  }}>
                    {gitCommitMessage}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              color: '#888'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📝</div>
              <h4 style={{ color: '#666', marginBottom: '8px' }}>No Changes</h4>
              <p style={{ color: '#888', fontSize: '14px', textAlign: 'center' }}>
                Your worktree is clean. Make some changes and they'll appear here.
              </p>
            </div>
          )}

          {/* Denial Confirmation Modal */}
          {showDenyConfirmation && (
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
                backgroundColor: '#2d3748',
                border: '1px solid #4a5568',
                borderRadius: '8px',
                padding: '24px',
                minWidth: '450px',
                maxWidth: '550px'
              }}>
                <h3 style={{ color: '#fff', marginBottom: '16px', marginTop: 0 }}>
                  ⚠️ Confirm Deny Changes
                </h3>
                <p style={{ color: '#a0aec0', marginBottom: '16px', lineHeight: '1.5' }}>
                  Choose how to handle the denial of changes:
                </p>

                {/* Option Selection */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    marginBottom: '12px',
                    cursor: 'pointer',
                    padding: '8px',
                    borderRadius: '4px',
                    backgroundColor: !deleteWorktreeOnDeny ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    border: !deleteWorktreeOnDeny ? '1px solid #3b82f6' : '1px solid transparent'
                  }}>
                    <input
                      type="radio"
                      name="denyOption"
                      checked={!deleteWorktreeOnDeny}
                      onChange={() => setDeleteWorktreeOnDeny(false)}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>
                        🔄 Revert Changes Only
                      </div>
                      <div style={{ color: '#a0aec0', fontSize: '13px' }}>
                        Reset all files to their last committed state, but keep the worktree and instance running.
                      </div>
                    </div>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    cursor: 'pointer',
                    padding: '8px',
                    borderRadius: '4px',
                    backgroundColor: deleteWorktreeOnDeny ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                    border: deleteWorktreeOnDeny ? '1px solid #ef4444' : '1px solid transparent'
                  }}>
                    <input
                      type="radio"
                      name="denyOption"
                      checked={deleteWorktreeOnDeny}
                      onChange={() => setDeleteWorktreeOnDeny(true)}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>
                        🗑️ Delete Entire Worktree
                      </div>
                      <div style={{ color: '#a0aec0', fontSize: '13px' }}>
                        Stop the instance, close terminals, and completely remove this worktree and all its contents.
                      </div>
                    </div>
                  </label>
                </div>

                <div style={{
                  color: deleteWorktreeOnDeny ? '#ef4444' : '#f59e0b',
                  fontSize: '13px',
                  marginBottom: '20px',
                  padding: '8px',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: '4px',
                  fontWeight: 'bold'
                }}>
                  ⚠️ {deleteWorktreeOnDeny ? 'This will permanently delete the entire worktree!' : 'This will permanently revert all changes!'}
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setShowDenyConfirmation(false);
                      setDeleteWorktreeOnDeny(false); // Reset checkbox when cancelling
                    }}
                    style={{
                      backgroundColor: 'transparent',
                      border: '1px solid #4a5568',
                      color: '#a0aec0',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDenyChanges}
                    disabled={isReverting}
                    style={{
                      backgroundColor: deleteWorktreeOnDeny ? '#dc3545' : '#f59e0b',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isReverting ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      opacity: isReverting ? 0.6 : 1
                    }}
                  >
                    {isReverting
                      ? (deleteWorktreeOnDeny ? 'Deleting Worktree...' : 'Reverting Changes...')
                      : (deleteWorktreeOnDeny ? 'Yes, Delete Worktree' : 'Yes, Revert Changes')
                    }
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};