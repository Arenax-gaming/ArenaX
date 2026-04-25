import React, { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '@/stores/gameStore';

interface PlayerControlsProps {
  className?: string;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({ className = '' }) => {
  const keysPressed = useRef<Set<string>>(new Set());
  const mousePosition = useRef({ x: 0, y: 0 });
  const isMouseDown = useRef(false);
  
  const localPlayer = useGameStore((state) => state.localPlayer);
  const updateLocalPlayer = useGameStore((state) => state.updateLocalPlayer);
  const gameStatus = useGameStore((state) => state.gameStatus);
  const settings = useGameStore((state) => state.settings);
  const addChatMessage = useGameStore((state) => state.addChatMessage);
  const setGameStatus = useGameStore((state) => state.setGameStatus);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (gameStatus !== 'playing') return;

    const key = event.key.toLowerCase();
    keysPressed.current.add(key);

    // Handle chat toggle
    if (key === settings.controls.chat.toLowerCase()) {
      event.preventDefault();
      // Chat handling would be implemented in ChatOverlay component
      return;
    }

    // Handle pause
    if (key === settings.controls.pause.toLowerCase()) {
      event.preventDefault();
      setGameStatus(gameStatus === 'paused' ? 'playing' : 'paused');
      return;
    }

    // Handle action
    if (key === settings.controls.action.toLowerCase()) {
      event.preventDefault();
      if (localPlayer) {
        // Perform action (e.g., shoot, interact)
        addChatMessage({
          playerId: 'system',
          playerName: 'System',
          message: 'Action performed!',
          type: 'system',
        });
      }
      return;
    }
  }, [gameStatus, settings, localPlayer, updateLocalPlayer, addChatMessage, setGameStatus]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    keysPressed.current.delete(key);
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    mousePosition.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (gameStatus !== 'playing') return;
    isMouseDown.current = true;
    
    // Handle mouse actions
    if (event.button === 0 && localPlayer) { // Left click
      // Perform action at mouse position
      addChatMessage({
        playerId: 'system',
        playerName: 'System',
        message: `Action at position (${event.clientX}, ${event.clientY})`,
        type: 'system',
      });
    }
  }, [gameStatus, localPlayer, addChatMessage]);

  const handleMouseUp = useCallback((event: MouseEvent) => {
    isMouseDown.current = false;
  }, []);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    // Handle right-click actions
  }, []);

  // Movement update loop
  const updateMovement = useCallback(() => {
    if (!localPlayer || gameStatus !== 'playing') return;

    let dx = 0;
    let dy = 0;
    const speed = 5; // pixels per frame

    const controls = settings.controls;
    
    if (keysPressed.current.has(controls.moveUp.toLowerCase())) dy -= speed;
    if (keysPressed.current.has(controls.moveDown.toLowerCase())) dy += speed;
    if (keysPressed.current.has(controls.moveLeft.toLowerCase())) dx -= speed;
    if (keysPressed.current.has(controls.moveRight.toLowerCase())) dx += speed;

    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      dx *= 0.707; // 1/sqrt(2)
      dy *= 0.707;
    }

    // Update player position
    const newX = Math.max(20, Math.min(780, localPlayer.x + dx));
    const newY = Math.max(20, Math.min(580, localPlayer.y + dy));

    if (newX !== localPlayer.x || newY !== localPlayer.y) {
      updateLocalPlayer({ x: newX, y: newY });
    }
  }, [localPlayer, gameStatus, settings, updateLocalPlayer]);

  // Game loop for movement
  useEffect(() => {
    let animationFrameId: number;

    const gameLoop = () => {
      updateMovement();
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    if (gameStatus === 'playing') {
      animationFrameId = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [updateMovement, gameStatus]);

  // Event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [handleKeyDown, handleKeyUp, handleMouseMove, handleMouseDown, handleMouseUp, handleContextMenu]);

  // Control guide overlay
  const ControlGuide = () => (
    <div className={`absolute bottom-4 right-4 bg-black bg-opacity-70 rounded-lg p-4 text-white text-sm ${className}`}>
      <div className="font-bold mb-2">Controls</div>
      <div className="space-y-1 text-xs">
        <div>Move: {settings.controls.moveUp.toUpperCase()}/{settings.controls.moveLeft.toUpperCase()}/{settings.controls.moveDown.toUpperCase()}/{settings.controls.moveRight.toUpperCase()}</div>
        <div>Action: {settings.controls.action.toUpperCase()}</div>
        <div>Chat: {settings.controls.chat.toUpperCase()}</div>
        <div>Pause: {settings.controls.pause.toUpperCase()}</div>
      </div>
    </div>
  );

  return (
    <>
      <ControlGuide />
      {/* Visual feedback for active keys */}
      <div className="absolute bottom-4 left-4 flex space-x-2">
        {Object.entries(settings.controls).map(([action, key]) => (
          keysPressed.current.has(key.toLowerCase()) && (
            <div
              key={action}
              className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-bold"
            >
              {key.toUpperCase()}
            </div>
          )
        ))}
      </div>
    </>
  );
};
