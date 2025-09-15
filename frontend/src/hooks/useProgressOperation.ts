import { useCallback } from 'react';
import { useProgress } from '../contexts/ProgressContext';

interface UseProgressOperationOptions {
  title: string;
  canCancel?: boolean;
  onCancel?: () => void | Promise<void>;
}

interface ProgressOperationControls {
  update: (progress: number, description?: string) => void;
  complete: (description?: string) => void;
  error: (description?: string) => void;
}

export function useProgressOperation() {
  const { startOperation, updateProgress, completeOperation, errorOperation } = useProgress();

  const withProgress = useCallback(async <T>(
    options: UseProgressOperationOptions,
    operation: (controls: ProgressOperationControls) => Promise<T>
  ): Promise<T> => {
    const operationId = startOperation({
      title: options.title,
      progress: -1, // Start with indeterminate progress
      canCancel: options.canCancel,
      onCancel: options.onCancel
    });

    const controls: ProgressOperationControls = {
      update: (progress: number, description?: string) => {
        updateProgress(operationId, progress, description);
      },
      complete: (description?: string) => {
        completeOperation(operationId, description);
      },
      error: (description?: string) => {
        errorOperation(operationId, description);
      }
    };

    try {
      const result = await operation(controls);
      controls.complete();
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Operation failed';
      controls.error(errorMessage);
      throw error;
    }
  }, [startOperation, updateProgress, completeOperation, errorOperation]);

  const withSimpleProgress = useCallback(async <T>(
    title: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    return withProgress(
      { title },
      async (_controls) => {
        const result = await operation();
        return result;
      }
    );
  }, [withProgress]);

  return {
    withProgress,
    withSimpleProgress
  };
}