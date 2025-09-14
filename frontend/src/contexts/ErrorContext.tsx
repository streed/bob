import React, { createContext, useContext, useReducer, useCallback } from 'react';

export interface AppError {
  id: string;
  type: 'instance' | 'repository' | 'terminal' | 'git' | 'network' | 'system';
  category: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
  context?: {
    instanceId?: string;
    repositoryId?: string;
    worktreeId?: string;
    sessionId?: string;
    operation?: string;
  };
  timestamp: Date;
  actions?: Array<{
    label: string;
    action: () => void | Promise<void>;
    style?: 'primary' | 'secondary' | 'danger';
  }>;
  dismissible: boolean;
  autoHide?: boolean;
  duration?: number;
}

interface ErrorState {
  errors: AppError[];
  maxErrors: number;
}

type ErrorAction =
  | { type: 'ADD_ERROR'; payload: Omit<AppError, 'id' | 'timestamp'> }
  | { type: 'DISMISS_ERROR'; payload: string }
  | { type: 'CLEAR_ERRORS' }
  | { type: 'CLEAR_ERRORS_BY_TYPE'; payload: AppError['type'] }
  | { type: 'CLEAR_ERRORS_BY_CONTEXT'; payload: Partial<NonNullable<AppError['context']>> };

const initialState: ErrorState = {
  errors: [],
  maxErrors: 10
};

function errorReducer(state: ErrorState, action: ErrorAction): ErrorState {
  switch (action.type) {
    case 'ADD_ERROR': {
      const newError: AppError = {
        ...action.payload,
        id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date()
      };

      let newErrors = [newError, ...state.errors];

      // Remove duplicate errors based on message and context
      newErrors = newErrors.filter((error, index) => {
        if (index === 0) return true; // Keep the new error
        return !(
          error.message === newError.message &&
          error.type === newError.type &&
          JSON.stringify(error.context) === JSON.stringify(newError.context)
        );
      });

      // Limit number of errors
      if (newErrors.length > state.maxErrors) {
        newErrors = newErrors.slice(0, state.maxErrors);
      }

      return { ...state, errors: newErrors };
    }

    case 'DISMISS_ERROR':
      return {
        ...state,
        errors: state.errors.filter(error => error.id !== action.payload)
      };

    case 'CLEAR_ERRORS':
      return { ...state, errors: [] };

    case 'CLEAR_ERRORS_BY_TYPE':
      return {
        ...state,
        errors: state.errors.filter(error => error.type !== action.payload)
      };

    case 'CLEAR_ERRORS_BY_CONTEXT': {
      return {
        ...state,
        errors: state.errors.filter(error => {
          if (!error.context) return true;

          for (const [key, value] of Object.entries(action.payload)) {
            if (error.context[key as keyof typeof error.context] === value) {
              return false;
            }
          }
          return true;
        })
      };
    }

    default:
      return state;
  }
}

interface ErrorContextValue {
  errors: AppError[];
  addError: (error: Omit<AppError, 'id' | 'timestamp'>) => void;
  dismissError: (id: string) => void;
  clearErrors: () => void;
  clearErrorsByType: (type: AppError['type']) => void;
  clearErrorsByContext: (context: Partial<NonNullable<AppError['context']>>) => void;
  // Helper methods for common error scenarios
  addInstanceError: (message: string, instanceId: string, details?: string, actions?: AppError['actions']) => void;
  addRepositoryError: (message: string, repositoryId: string, details?: string, actions?: AppError['actions']) => void;
  addTerminalError: (message: string, sessionId: string, details?: string, actions?: AppError['actions']) => void;
  addNetworkError: (message: string, operation: string, details?: string, actions?: AppError['actions']) => void;
}

const ErrorContext = createContext<ErrorContextValue | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(errorReducer, initialState);

  // Auto-dismiss errors with autoHide
  React.useEffect(() => {
    const timers: Record<string, NodeJS.Timeout> = {};

    for (const error of state.errors) {
      if (error.autoHide && error.duration && !timers[error.id]) {
        timers[error.id] = setTimeout(() => {
          dispatch({ type: 'DISMISS_ERROR', payload: error.id });
          delete timers[error.id];
        }, error.duration);
      }
    }

    return () => {
      Object.values(timers).forEach(timer => clearTimeout(timer));
    };
  }, [state.errors]);

  const addError = useCallback((error: Omit<AppError, 'id' | 'timestamp'>) => {
    dispatch({ type: 'ADD_ERROR', payload: error });
  }, []);

  const dismissError = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_ERROR', payload: id });
  }, []);

  const clearErrors = useCallback(() => {
    dispatch({ type: 'CLEAR_ERRORS' });
  }, []);

  const clearErrorsByType = useCallback((type: AppError['type']) => {
    dispatch({ type: 'CLEAR_ERRORS_BY_TYPE', payload: type });
  }, []);

  const clearErrorsByContext = useCallback((context: Partial<NonNullable<AppError['context']>>) => {
    dispatch({ type: 'CLEAR_ERRORS_BY_CONTEXT', payload: context });
  }, []);

  // Helper methods
  const addInstanceError = useCallback((
    message: string,
    instanceId: string,
    details?: string,
    actions?: AppError['actions']
  ) => {
    addError({
      type: 'instance',
      category: 'error',
      message,
      details,
      context: { instanceId },
      actions,
      dismissible: true,
      autoHide: false
    });
  }, [addError]);

  const addRepositoryError = useCallback((
    message: string,
    repositoryId: string,
    details?: string,
    actions?: AppError['actions']
  ) => {
    addError({
      type: 'repository',
      category: 'error',
      message,
      details,
      context: { repositoryId },
      actions,
      dismissible: true,
      autoHide: false
    });
  }, [addError]);

  const addTerminalError = useCallback((
    message: string,
    sessionId: string,
    details?: string,
    actions?: AppError['actions']
  ) => {
    addError({
      type: 'terminal',
      category: 'error',
      message,
      details,
      context: { sessionId },
      actions,
      dismissible: true,
      autoHide: true,
      duration: 5000
    });
  }, [addError]);

  const addNetworkError = useCallback((
    message: string,
    operation: string,
    details?: string,
    actions?: AppError['actions']
  ) => {
    addError({
      type: 'network',
      category: 'error',
      message,
      details,
      context: { operation },
      actions,
      dismissible: true,
      autoHide: true,
      duration: 8000
    });
  }, [addError]);

  const contextValue: ErrorContextValue = {
    errors: state.errors,
    addError,
    dismissError,
    clearErrors,
    clearErrorsByType,
    clearErrorsByContext,
    addInstanceError,
    addRepositoryError,
    addTerminalError,
    addNetworkError
  };

  return <ErrorContext.Provider value={contextValue}>{children}</ErrorContext.Provider>;
};

export const useError = () => {
  const context = useContext(ErrorContext);
  if (context === undefined) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
};