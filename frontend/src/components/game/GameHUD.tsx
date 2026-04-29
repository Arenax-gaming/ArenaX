import React from 'react';
import { Heart, Trophy, Shield, Zap } from 'lucide-react';
import { useGameStore } from '@/stores/gameStore';

interface GameHUDProps {
  className?: string;
}

export const GameHUD: React.FC<GameHUDProps> = ({ className = '' }) => {
  const localPlayer = useGameStore((state) => state.localPlayer);
  const gameStatus = useGameStore((state) => state.gameStatus);
  const gameTime = useGameStore((state) => state.gameTime);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getHealthColor = (percentage: number): string => {
    if (percentage > 0.6) return 'text-green-500';
    if (percentage > 0.3) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (!localPlayer) return null;

  const healthPercentage = localPlayer.health / localPlayer.maxHealth;

  return (
    <div className={`absolute top-0 left-0 right-0 pointer-events-none ${className}`}>
      {/* Top HUD Bar */}
      <div className="flex justify-between items-start p-4">
        {/* Health & Score Display */}
        <div className="flex flex-col space-y-2">
          {/* Health Bar */}
          <div className="bg-black bg-opacity-70 rounded-lg p-3 flex items-center space-x-3">
            <Heart className={`w-5 h-5 ${getHealthColor(healthPercentage)}`} />
            <div className="flex flex-col">
              <div className="text-white text-sm font-semibold">Health</div>
              <div className="flex items-center space-x-2">
                <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      healthPercentage > 0.6 ? 'bg-green-500' :
                      healthPercentage > 0.3 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${healthPercentage * 100}%` }}
                  />
                </div>
                <span className="text-white text-xs font-mono">
                  {localPlayer.health}/{localPlayer.maxHealth}
                </span>
              </div>
            </div>
          </div>

          {/* Score Display */}
          <div className="bg-black bg-opacity-70 rounded-lg p-3 flex items-center space-x-3">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <div className="flex flex-col">
              <div className="text-white text-sm font-semibold">Score</div>
              <div className="text-yellow-400 text-xl font-bold">
                {localPlayer.score.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Game Status & Timer */}
        <div className="flex flex-col items-end space-y-2">
          {/* Game Status */}
          <div className="bg-black bg-opacity-70 rounded-lg px-4 py-2">
            <div className={`text-sm font-bold ${
              gameStatus === 'playing' ? 'text-green-500' :
              gameStatus === 'paused' ? 'text-yellow-500' :
              gameStatus === 'ended' ? 'text-red-500' :
              'text-gray-500'
            }`}>
              {gameStatus.toUpperCase()}
            </div>
          </div>

          {/* Game Timer */}
          <div className="bg-black bg-opacity-70 rounded-lg px-4 py-2 flex items-center space-x-2">
            <Zap className="w-4 h-4 text-blue-500" />
            <div className="text-white text-lg font-mono font-bold">
              {formatTime(gameTime)}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom HUD Bar */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="flex justify-center">
          {/* Power-up indicators */}
          <div className="bg-black bg-opacity-70 rounded-lg px-6 py-3 flex items-center space-x-4">
            <Shield className="w-5 h-5 text-blue-500" />
            <div className="text-white text-sm">
              <div className="font-semibold">Shield Active</div>
              <div className="text-xs text-gray-400">2:30 remaining</div>
            </div>
          </div>
        </div>
      </div>

      {/* Damage Indicator */}
      {localPlayer.health < localPlayer.maxHealth * 0.3 && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 border-4 border-red-500 opacity-50 animate-pulse" />
        </div>
      )}
    </div>
  );
};
