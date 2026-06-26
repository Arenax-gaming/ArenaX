'use client';

import { useEffect, useRef, useCallback } from 'react';
import { RemoteCursor } from '@/types/collaboration';

interface CursorOverlayProps {
  cursors: RemoteCursor[];
  onCursorMove?: (x: number, y: number) => void;
  enabled?: boolean;
}

export function CursorOverlay({ cursors, onCursorMove, enabled = true }: CursorOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!enabled || !onCursorMove) return;
    onCursorMove(e.clientX, e.clientY);
  }, [enabled, onCursorMove]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [enabled, handleMouseMove]);

  if (!enabled || cursors.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 pointer-events-none z-50"
      aria-hidden="true"
    >
      {cursors.map(cursor => (
        <div
          key={cursor.userId}
          className="absolute transition-[left,top] duration-75 ease-linear"
          style={{
            left: cursor.position.x,
            top: cursor.position.y,
            transform: 'translate(-2px, -2px)',
          }}
        >
          <svg
            width="16"
            height="20"
            viewBox="0 0 16 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1 1L12 17L8.5 11.5L15 13L1 1Z"
              fill={cursor.color}
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="absolute left-4 top-0 px-1.5 py-0.5 text-xs font-medium rounded whitespace-nowrap"
            style={{ backgroundColor: cursor.color, color: '#fff' }}
          >
            {cursor.username}
          </span>
        </div>
      ))}
    </div>
  );
}
