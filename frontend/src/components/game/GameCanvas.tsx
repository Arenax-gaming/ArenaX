import React, { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '@/stores/gameStore';

interface GameCanvasProps {
  width?: number;
  height?: number;
  className?: string;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  width = 800,
  height = 600,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const fpsRef = useRef<number>(60);
  
  const localPlayer = useGameStore((state) => state.localPlayer);
  const players = useGameStore((state) => state.players);
  const gameStatus = useGameStore((state) => state.gameStatus);
  const updatePerformanceMetrics = useGameStore((state) => state.updatePerformanceMetrics);
  const updateLocalPlayer = useGameStore((state) => state.updateLocalPlayer);

  // Game rendering loop
  const gameLoop = useCallback((currentTime: number) => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate FPS
    const deltaTime = currentTime - lastTimeRef.current;
    if (deltaTime > 0) {
      fpsRef.current = 1000 / deltaTime;
    }
    lastTimeRef.current = currentTime;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Draw grid background
    ctx.strokeStyle = '#16213e';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw all players
    [...(localPlayer ? [localPlayer] : []), ...players].forEach((player) => {
      // Draw player circle
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
      ctx.fill();

      // Draw player border
      ctx.strokeStyle = player.isLocal ? '#ffffff' : '#666666';
      ctx.lineWidth = player.isLocal ? 3 : 2;
      ctx.stroke();

      // Draw health bar
      const healthPercentage = player.health / player.maxHealth;
      const barWidth = 40;
      const barHeight = 4;
      const barX = player.x - barWidth / 2;
      const barY = player.y - 30;

      ctx.fillStyle = '#333333';
      ctx.fillRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle = healthPercentage > 0.5 ? '#00ff00' : 
                      healthPercentage > 0.25 ? '#ffff00' : '#ff0000';
      ctx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);

      // Draw player name
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(player.name, player.x, player.y - 35);
    });

    // Draw game status overlay
    if (gameStatus === 'paused') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', width / 2, height / 2);
    } else if (gameStatus === 'ended') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('GAME ENDED', width / 2, height / 2);
    }

    // Update performance metrics
    updatePerformanceMetrics({
      fps: Math.round(fpsRef.current),
      frameTime: deltaTime,
    });

    // Continue game loop
    if (gameStatus === 'playing') {
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    }
  }, [width, height, localPlayer, players, gameStatus, updatePerformanceMetrics]);

  // Start/stop game loop based on game status
  useEffect(() => {
    if (gameStatus === 'playing') {
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameStatus, gameLoop]);

  // Handle canvas resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        canvasRef.current.width = width;
        canvasRef.current.height = height;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [width, height]);

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-700 rounded-lg shadow-2xl"
        style={{ imageRendering: 'crisp-edges' }}
      />
      {useGameStore((state) => state.settings.showFPS) && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm font-mono">
          FPS: {Math.round(fpsRef.current)}
        </div>
      )}
    </div>
  );
};
