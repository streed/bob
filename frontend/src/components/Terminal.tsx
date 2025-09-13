import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalComponentProps {
  sessionId: string;
  onClose: () => void;
}

export const TerminalComponent: React.FC<TerminalComponentProps> = ({ sessionId, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const websocket = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxReconnectAttempts = 3;
  const reconnectAttemptsRef = useRef(0);

  const connectWebSocket = () => {
    if (websocket.current?.readyState === WebSocket.CONNECTING || websocket.current?.readyState === WebSocket.OPEN) {
      return; // Already connecting or connected
    }

    setConnectionState('connecting');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:3001?sessionId=${sessionId}`;
    websocket.current = new WebSocket(wsUrl);

    websocket.current.onopen = () => {
      console.log('WebSocket connected');
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
      
      // Fit terminal when connection is established
      setTimeout(() => {
        if (fitAddon.current && terminal.current) {
          try {
            fitAddon.current.fit();
          } catch (error) {
            console.warn('Connection fit error:', error);
          }
        }
      }, 100);
    };

    websocket.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'data':
            terminal.current?.write(message.data);
            break;
          case 'ready':
            terminal.current?.focus();
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.current.onclose = (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      setConnectionState('closed');
      
      // Only show error message if it's not a normal closure or session not found
      if (event.code !== 1000 && event.reason !== 'Session not found') {
        // Don't show the error message immediately, try to reconnect first
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          attemptReconnect();
        } else {
          terminal.current?.write('\r\n\x1b[31mConnection closed\x1b[0m\r\n');
        }
      }
    };

    websocket.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionState('error');
      
      // Don't show error message immediately if we haven't tried reconnecting
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        terminal.current?.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
      }
    };
  };

  const attemptReconnect = () => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      terminal.current?.write('\r\n\x1b[31mFailed to establish connection after multiple attempts\x1b[0m\r\n');
      return;
    }

    reconnectAttemptsRef.current++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 5000); // Exponential backoff, max 5s
    
    console.log(`Attempting to reconnect (${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${delay}ms`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      connectWebSocket();
    }, delay);
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    terminal.current = new Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#e5e5e5',
        cursor: '#ffffff',
      },
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    });

    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.open(terminalRef.current);
    
    // Multiple fitting attempts to ensure proper sizing
    const fitTerminal = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
        } catch (error) {
          console.warn('Terminal fit error:', error);
        }
      }
    };

    // Initial fit with small delay
    setTimeout(fitTerminal, 100);
    
    // Additional fits to ensure proper sizing
    setTimeout(fitTerminal, 300);
    setTimeout(fitTerminal, 600);
    setTimeout(fitTerminal, 1000);

    // Delay the WebSocket connection slightly to ensure the session is ready
    setTimeout(() => {
      connectWebSocket();
    }, 100);

    terminal.current.onData((data) => {
      if (websocket.current?.readyState === WebSocket.OPEN) {
        websocket.current.send(JSON.stringify({ type: 'data', data }));
      }
    });

    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
          const dims = fitAddon.current.proposeDimensions();
          if (dims && websocket.current?.readyState === WebSocket.OPEN) {
            websocket.current.send(JSON.stringify({ 
              type: 'resize', 
              cols: dims.cols, 
              rows: dims.rows 
            }));
          }
        } catch (error) {
          console.warn('Resize fit error:', error);
        }
      }
    };

    // Listen for window resize
    window.addEventListener('resize', handleResize);

    // Create ResizeObserver to watch container size changes
    const resizeObserver = new ResizeObserver(() => {
      // Immediate resize for better responsiveness
      handleResize();
      // Also do a delayed resize to catch any missed sizing
      setTimeout(() => {
        handleResize();
      }, 100);
    });
    
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      // Clean up timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      websocket.current?.close();
      terminal.current?.dispose();
    };
  }, [sessionId]);

  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column',
      minHeight: 0,
      height: '100%'
    }}>
      <div style={{ 
        padding: '4px 8px', 
        background: '#333', 
        borderBottom: '1px solid #444',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        minHeight: '28px',
        height: '28px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#ccc' }}>
            Terminal Session: {sessionId.slice(-8)}
          </span>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor:
                connectionState === 'connected' ? '#28a745' :
                connectionState === 'connecting' ? '#ffc107' :
                connectionState === 'error' ? '#dc3545' : '#6c757d'
            }}
            title={`Connection: ${connectionState}`}
          />
        </div>
        <button 
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#ccc',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          ×
        </button>
      </div>
      <div ref={terminalRef} style={{ 
        flex: 1, 
        minHeight: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a'
      }} />
    </div>
  );
};