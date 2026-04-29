import React, { useRef, useEffect } from 'react';
import { Map, Navigation, Eye, EyeOff } from 'lucide-react';
import { useGameStore } from '@/stores/gameStore';

interface MinimapProps {
  className?: string;
  width?: number;
  height?: number;
  worldWidth?: number;
  worldHeight?: number;
}

export const Minimap: React.FC<MinimapProps> = ({ 
  className = '',
  width = 200,
  height = 150,
  worldWidth = 800,
  worldHeight = 600
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const localPlayer = useGameStore((state) => state.localPlayer);
  const players = useGameStore((state) => state.players);
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);

  // Draw minimap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    const gridSize = 20;
    
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw border
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, width, height);

    // Scale factors for mapping world coordinates to minimap
    const scaleX = width / worldWidth;
    const scaleY = height / worldHeight;

    // Draw all players
    [...(localPlayer ? [localPlayer] : []), ...players].forEach((player) => {
      const x = player.x * scaleX;
      const y = player.y * scaleY;
      
      // Draw player dot
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(x, y, player.isLocal ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();

      // Draw player border
      ctx.strokeStyle = player.isLocal ? '#ffffff' : '#666666';
      ctx.lineWidth = player.isLocal ? 2 : 1;
      ctx.stroke();

      // Draw player name (only for local player to avoid clutter)
      if (player.isLocal) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, x, y - 8);
      }
    });

    // Draw viewport indicator (shows what's visible on main screen)
    if (localPlayer) {
      const viewportWidth = 800 * scaleX; // Assuming main canvas is 800px wide
      const viewportHeight = 600 * scaleY; // Assuming main canvas is 600px high
      const viewportX = (localPlayer.x - 400) * scaleX; // Center on player
      const viewportY = (localPlayer.y - 300) * scaleY; // Center on player

      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        Math.max(0, viewportX),
        Math.max(0, viewportY),
        Math.min(width, viewportWidth),
        Math.min(height, viewportHeight)
      );
      ctx.setLineDash([]);
    }

    // Draw objectives/zones (example)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    
    // Example: Draw a capture zone in the center
    const zoneX = (worldWidth / 2) * scaleX;
    const zoneY = (worldHeight / 2) * scaleY;
    const zoneSize = 50;
    
    ctx.fillRect(zoneX - zoneSize/2, zoneY - zoneSize/2, zoneSize, zoneSize);
    ctx.strokeRect(zoneX - zoneSize/2, zoneY - zoneSize/2, zoneSize, zoneSize);

  }, [width, height, worldWidth, worldHeight, localPlayer, players]);

  const toggleMinimap = () => {
    updateSettings({ showMinimap: !settings.showMinimap });
  };

  if (!settings.showMinimap) {
    return (
      <div className={`bg-black bg-opacity-70 rounded-lg p-2 flex items-center justify-center ${className}`}>
        <button
          onClick={toggleMinimap}
          className="text-gray-400 hover:text-white transition-colors"
          title="Show Minimap"
        >
          <EyeOff className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-black bg-opacity-70 rounded-lg p-2 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-1">
          <Map className="w-4 h-4 text-blue-500" />
          <span className="text-white text-xs font-bold">Minimap</span>
        </div>
        <button
          onClick={toggleMinimap}
          className="text-gray-400 hover:text-white transition-colors"
          title="Hide Minimap"
        >
          <Eye className="w-3 h-3" />
        </button>
      </div>

      {/* Minimap Canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="border border-gray-700 rounded"
        />
        
        {/* Player count indicator */}
        <div className="absolute top-1 right-1 bg-black bg-opacity-70 px-1 py-0.5 rounded">
          <span className="text-white text-xs">
            {1 + players.length}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 space-y-1">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-green-500 border border-white" />
          <span className="text-gray-400 text-xs">You</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 border border-gray-600" />
          <span className="text-gray-400 text-xs">Others</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 border border-yellow-500" />
          <span className="text-gray-400 text-xs">View</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-green-500 opacity-30 border border-green-500" />
          <span className="text-gray-400 text-xs">Zone</span>
        </div>
      </div>

      {/* Coordinates */}
      {localPlayer && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="flex items-center space-x-1">
            <Navigation className="w-3 h-3 text-gray-500" />
            <span className="text-gray-400 text-xs font-mono">
              X: {Math.round(localPlayer.x)} Y: {Math.round(localPlayer.y)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
