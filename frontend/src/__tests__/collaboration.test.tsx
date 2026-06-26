import { useCollaboration } from '@/hooks/useCollaboration';
import { CursorOverlay } from '@/components/collaboration/CursorOverlay';
import { PresenceIndicator } from '@/components/collaboration/PresenceIndicator';
import { CollaborativeStateIndicator } from '@/components/collaboration/CollaborativeState';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { RemoteCursor, PresenceUser, CollaborationState } from '@/types/collaboration';

describe('CursorOverlay', () => {
  const mockCursors: RemoteCursor[] = [
    {
      userId: 'user-1',
      username: 'Alice',
      color: '#FF6B6B',
      position: { x: 100, y: 200 },
      lastUpdated: Date.now(),
    },
    {
      userId: 'user-2',
      username: 'Bob',
      color: '#4ECDC4',
      position: { x: 300, y: 400 },
      lastUpdated: Date.now(),
    },
  ];

  it('renders cursor indicators for each remote user', () => {
    const { container } = render(<CursorOverlay cursors={mockCursors} enabled={true} />);

    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders nothing when disabled', () => {
    const { container } = render(<CursorOverlay cursors={mockCursors} enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with empty cursors', () => {
    const { container } = render(<CursorOverlay cursors={[]} enabled={true} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('PresenceIndicator', () => {
  const mockUsers: PresenceUser[] = [
    { userId: '1', username: 'Alice', color: '#FF6B6B', status: 'online', lastSeen: Date.now() },
    { userId: '2', username: 'Bob', color: '#4ECDC4', status: 'online', lastSeen: Date.now() },
    { userId: '3', username: 'Charlie', color: '#45B7D1', status: 'away', lastSeen: Date.now() },
    { userId: '4', username: 'Diana', color: '#96CEB4', status: 'busy', lastSeen: Date.now() },
    { userId: '5', username: 'Eve', color: '#FFEAA7', status: 'offline', lastSeen: Date.now() },
    { userId: '6', username: 'Frank', color: '#DDA0DD', status: 'online', lastSeen: Date.now() },
  ];

  it('shows limited avatars by default', () => {
    render(<PresenceIndicator users={mockUsers} maxVisible={3} />);
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('3 online')).toBeInTheDocument();
  });

  it('shows all avatars when expanded', () => {
    render(<PresenceIndicator users={mockUsers} maxVisible={3} />);
    const plusButton = screen.getByText('+3');
    plusButton.click();
    expect(screen.queryByText('+3')).not.toBeInTheDocument();
  });
});

describe('CollaborativeStateIndicator', () => {
  const mockState: CollaborationState = {
    document: { content: 'test' },
    version: 5,
    lastModified: Date.now(),
    modifiedBy: 'user-1',
    pendingChanges: [],
    conflicts: [],
  };

  it('shows connected state', () => {
    render(<CollaborativeStateIndicator state={mockState} isConnected={true} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('v5')).toBeInTheDocument();
  });

  it('shows disconnected state', () => {
    render(<CollaborativeStateIndicator state={mockState} isConnected={false} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows pending changes count', () => {
    const stateWithChanges: CollaborationState = {
      ...mockState,
      pendingChanges: [
        { type: 'edit', userId: 'user-1', payload: { text: 'hello' }, timestamp: Date.now(), version: 6 },
      ],
    };
    render(<CollaborativeStateIndicator state={stateWithChanges} isConnected={true} />);
    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('shows conflicts count', () => {
    const stateWithConflicts: CollaborationState = {
      ...mockState,
      conflicts: [
        { actionId: 'action-1', strategy: 'lastWriteWins', resolved: true, timestamp: Date.now() },
      ],
    };
    render(<CollaborativeStateIndicator state={stateWithConflicts} isConnected={true} />);
    expect(screen.getByText('1 conflict')).toBeInTheDocument();
  });
});
