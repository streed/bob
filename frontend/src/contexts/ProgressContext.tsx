import React, { createContext, useContext, useReducer, useCallback } from 'react';

export interface ProgressOperation {
  id: string;
  title: string;
  description?: string;
  progress: number; // 0-100, -1 for indeterminate
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
  canCancel?: boolean;
  onCancel?: () => void | Promise<void>;
  metadata?: Record<string, any>;
}

interface ProgressState {
  operations: ProgressOperation[];
}

type ProgressAction =
  | { type: 'START_OPERATION'; payload: Omit<ProgressOperation, 'id' | 'startTime' | 'status'> }
  | { type: 'UPDATE_PROGRESS'; payload: { id: string; progress: number; description?: string } }
  | { type: 'COMPLETE_OPERATION'; payload: { id: string; description?: string } }
  | { type: 'ERROR_OPERATION'; payload: { id: string; description?: string } }
  | { type: 'CANCEL_OPERATION'; payload: string }
  | { type: 'REMOVE_OPERATION'; payload: string }
  | { type: 'CLEAR_COMPLETED' };

const initialState: ProgressState = {
  operations: []
};

function progressReducer(state: ProgressState, action: ProgressAction): ProgressState {
  switch (action.type) {
    case 'START_OPERATION': {
      const newOperation: ProgressOperation = {
        ...action.payload,
        id: `progress-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        startTime: new Date(),
        status: 'running'
      };

      return {
        ...state,
        operations: [newOperation, ...state.operations]
      };
    }

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        operations: state.operations.map(op =>
          op.id === action.payload.id
            ? {
                ...op,
                progress: action.payload.progress,
                description: action.payload.description || op.description
              }
            : op
        )
      };

    case 'COMPLETE_OPERATION':
      return {
        ...state,
        operations: state.operations.map(op =>
          op.id === action.payload.id
            ? {
                ...op,
                status: 'completed',
                progress: 100,
                endTime: new Date(),
                description: action.payload.description || op.description
              }
            : op
        )
      };

    case 'ERROR_OPERATION':
      return {
        ...state,
        operations: state.operations.map(op =>
          op.id === action.payload.id
            ? {
                ...op,
                status: 'error',
                endTime: new Date(),
                description: action.payload.description || op.description
              }
            : op
        )
      };

    case 'CANCEL_OPERATION':
      return {
        ...state,
        operations: state.operations.filter(op => {
          if (op.id === action.payload) {
            if (op.onCancel) {
              op.onCancel();
            }
            return false;
          }
          return true;
        })
      };

    case 'REMOVE_OPERATION':
      return {
        ...state,
        operations: state.operations.filter(op => op.id !== action.payload)
      };

    case 'CLEAR_COMPLETED':
      return {
        ...state,
        operations: state.operations.filter(op => op.status === 'running')
      };

    default:
      return state;
  }
}

interface ProgressContextValue {
  operations: ProgressOperation[];
  startOperation: (operation: Omit<ProgressOperation, 'id' | 'startTime' | 'status'>) => string;
  updateProgress: (id: string, progress: number, description?: string) => void;
  completeOperation: (id: string, description?: string) => void;
  errorOperation: (id: string, description?: string) => void;
  cancelOperation: (id: string) => void;
  removeOperation: (id: string) => void;
  clearCompleted: () => void;
}

const ProgressContext = createContext<ProgressContextValue | undefined>(undefined);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(progressReducer, initialState);

  // Auto-remove completed/error operations after delay
  React.useEffect(() => {
    const timers: Record<string, NodeJS.Timeout> = {};

    for (const operation of state.operations) {
      if ((operation.status === 'completed' || operation.status === 'error') && !timers[operation.id]) {
        timers[operation.id] = setTimeout(() => {
          dispatch({ type: 'REMOVE_OPERATION', payload: operation.id });
          delete timers[operation.id];
        }, operation.status === 'completed' ? 3000 : 8000); // Keep errors longer
      }
    }

    return () => {
      Object.values(timers).forEach(timer => clearTimeout(timer));
    };
  }, [state.operations]);

  const startOperation = useCallback((operation: Omit<ProgressOperation, 'id' | 'startTime' | 'status'>) => {
    dispatch({ type: 'START_OPERATION', payload: operation });
    // Return the ID (we need to simulate the ID generation)
    return `progress-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const updateProgress = useCallback((id: string, progress: number, description?: string) => {
    dispatch({ type: 'UPDATE_PROGRESS', payload: { id, progress, description } });
  }, []);

  const completeOperation = useCallback((id: string, description?: string) => {
    dispatch({ type: 'COMPLETE_OPERATION', payload: { id, description } });
  }, []);

  const errorOperation = useCallback((id: string, description?: string) => {
    dispatch({ type: 'ERROR_OPERATION', payload: { id, description } });
  }, []);

  const cancelOperation = useCallback((id: string) => {
    dispatch({ type: 'CANCEL_OPERATION', payload: id });
  }, []);

  const removeOperation = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_OPERATION', payload: id });
  }, []);

  const clearCompleted = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, []);

  const contextValue: ProgressContextValue = {
    operations: state.operations,
    startOperation,
    updateProgress,
    completeOperation,
    errorOperation,
    cancelOperation,
    removeOperation,
    clearCompleted
  };

  return <ProgressContext.Provider value={contextValue}>{children}</ProgressContext.Provider>;
};

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (context === undefined) {
    throw new Error('useProgress must be used within a ProgressProvider');
  }
  return context;
};