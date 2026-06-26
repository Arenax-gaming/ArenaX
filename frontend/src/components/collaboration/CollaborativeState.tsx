'use client';

import { CollaborationState } from '@/types/collaboration';
import { cn } from '@/lib/utils';

interface CollaborativeStateIndicatorProps {
  state: CollaborationState;
  isConnected: boolean;
  className?: string;
}

export function CollaborativeStateIndicator({
  state,
  isConnected,
  className,
}: CollaborativeStateIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-3 text-xs', className)}>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            isConnected ? 'bg-green-500' : 'bg-red-500'
          )}
        />
        <span className="text-muted-foreground">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <span className="text-muted-foreground">
        v{state.version}
      </span>

      {state.pendingChanges.length > 0 && (
        <span className="text-yellow-500">
          {state.pendingChanges.length} pending
        </span>
      )}

      {state.conflicts.length > 0 && (
        <span className="text-red-500">
          {state.conflicts.length} conflict{state.conflicts.length > 1 ? 's' : ''}
        </span>
      )}

      <span className="text-muted-foreground">
        Last edit: {new Date(state.lastModified).toLocaleTimeString()}
      </span>
    </div>
  );
}
