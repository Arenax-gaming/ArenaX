import React, { useEffect, useRef, useState } from 'react';
import { Clock, AlertTriangle, Play, Pause } from 'lucide-react';
import { useGameStore } from '@/stores/gameStore';

interface GameTimerProps {
  className?: string;
  showControls?: boolean;
}

export const GameTimer: React.FC<GameTimerProps> = ({ 
  className = '',
  showControls = false 
}) => {
  const intervalRef = useRef<NodeJS.Timeout>();
  const [isHovered, setIsHovered] = useState(false);
  
  const gameTime = useGameStore((state) => state.gameTime);
  const maxGameTime = useGameStore((state) => state.maxGameTime);
  const gameStatus = useGameStore((state) => state.gameStatus);
  const updateGameTime = useGameStore((state) => state.updateGameTime);
  const setGameStatus = useGameStore((state) => state.setGameStatus);
  const startGame = useGameStore((state) => state.startGame);

  // Timer effect
  useEffect(() => {
    if (gameStatus === 'playing') {
      intervalRef.current = setInterval(() => {
        updateGameTime(gameTime + 1);
        
        // Check if game time is up
        if (gameTime + 1 >= maxGameTime) {
          setGameStatus('ended');
        }
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [gameStatus, gameTime, maxGameTime, updateGameTime, setGameStatus]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimeRemaining = (): number => {
    return Math.max(0, maxGameTime - gameTime);
  };

  const getTimePercentage = (): number => {
    return (gameTime / maxGameTime) * 100;
  };

  const getTimerColor = (): string => {
    const remaining = getTimeRemaining();
    const percentage = (remaining / maxGameTime) * 100;
    
    if (percentage <= 10) return 'text-red-500';
    if (percentage <= 30) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getProgressColor = (): string => {
    const percentage = getTimePercentage();
    
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const handleStart = () => {
    if (gameStatus === 'waiting' || gameStatus === 'ended') {
      startGame();
    }
  };

  const handlePause = () => {
    if (gameStatus === 'playing') {
      setGameStatus('paused');
    } else if (gameStatus === 'paused') {
      setGameStatus('playing');
    }
  };

  const handleReset = () => {
    updateGameTime(0);
    setGameStatus('waiting');
  };

  return (
    <div 
      className={`bg-black bg-opacity-70 rounded-lg p-4 ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Timer Display */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Clock className={`w-5 h-5 ${getTimerColor()}`} />
          <span className="text-white font-bold">Game Timer</span>
        </div>
        
        {/* Warning indicator */}
        {getTimeRemaining() <= 30 && getTimeRemaining() > 0 && (
          <div className="flex items-center space-x-1 text-red-500 animate-pulse">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-bold">Time Low!</span>
          </div>
        )}
      </div>

      {/* Main Timer Display */}
      <div className="text-center mb-3">
        <div className={`text-4xl font-bold font-mono ${getTimerColor()}`}>
          {formatTime(getTimeRemaining())}
        </div>
        <div className="text-gray-400 text-sm mt-1">
          {gameStatus === 'playing' ? 'Time Remaining' :
           gameStatus === 'paused' ? 'Paused' :
           gameStatus === 'ended' ? 'Game Ended' :
           'Ready to Start'}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div 
            className={`h-full transition-all duration-1000 ${getProgressColor()}`}
            style={{ width: `${getTimePercentage()}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{formatTime(0)}</span>
          <span>{formatTime(gameTime)}</span>
          <span>{formatTime(maxGameTime)}</span>
        </div>
      </div>

      {/* Control Buttons */}
      {(showControls || isHovered) && (
        <div className="flex justify-center space-x-2">
          {(gameStatus === 'waiting' || gameStatus === 'ended') && (
            <button
              onClick={handleStart}
              className="flex items-center space-x-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm transition-colors"
            >
              <Play className="w-3 h-3" />
              <span>Start</span>
            </button>
          )}
          
          {(gameStatus === 'playing' || gameStatus === 'paused') && (
            <button
              onClick={handlePause}
              className="flex items-center space-x-1 bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-sm transition-colors"
            >
              <Pause className="w-3 h-3" />
              <span>{gameStatus === 'playing' ? 'Pause' : 'Resume'}</span>
            </button>
          )}
          
          <button
            onClick={handleReset}
            className="flex items-center space-x-1 bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded text-sm transition-colors"
          >
            <span>Reset</span>
          </button>
        </div>
      )}

      {/* Game Status Indicator */}
      <div className="mt-3 pt-3 border-t border-gray-700">
        <div className="flex items-center justify-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${
            gameStatus === 'playing' ? 'bg-green-500 animate-pulse' :
            gameStatus === 'paused' ? 'bg-yellow-500' :
            gameStatus === 'ended' ? 'bg-red-500' :
            'bg-gray-500'
          }`} />
          <span className={`text-xs font-bold ${
            gameStatus === 'playing' ? 'text-green-500' :
            gameStatus === 'paused' ? 'text-yellow-500' :
            gameStatus === 'ended' ? 'text-red-500' :
            'text-gray-500'
          }`}>
            {gameStatus.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
};
