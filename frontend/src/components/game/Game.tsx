import React, { useState, useEffect } from 'react';
import { Settings, Play, Pause, Square } from 'lucide-react';
import { GameCanvas } from './GameCanvas';
import { GameHUD } from './GameHUD';
import { PlayerControls } from './PlayerControls';
import { ScoreBoard } from './ScoreBoard';
import { GameTimer } from './GameTimer';
import { Minimap } from './Minimap';
import { ChatOverlay } from './ChatOverlay';
import { SettingsOverlay } from './SettingsOverlay';
import { useGameStore } from '@/stores/gameStore';

interface GameProps {
  className?: string;
}

export const Game: React.FC<GameProps> = ({ className = '' }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  
  const gameStatus = useGameStore((state) => state.gameStatus);
  const setGameStatus = useGameStore((state) => state.setGameStatus);
  const startGame = useGameStore((state) => state.startGame);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const endGame = useGameStore((state) => state.endGame);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Tab for scoreboard
      if (event.key === 'Tab') {
        event.preventDefault();
        setShowScoreboard(!showScoreboard);
      }
      
      // Escape for settings
      if (event.key === 'Escape' && gameStatus !== 'playing') {
        setShowSettings(!showSettings);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showScoreboard, showSettings, gameStatus]);

  const handleGameControl = () => {
    switch (gameStatus) {
      case 'waiting':
      case 'ended':
        startGame();
        break;
      case 'playing':
        pauseGame();
        break;
      case 'paused':
        resumeGame();
        break;
    }
  };

  const getGameControlIcon = () => {
    switch (gameStatus) {
      case 'waiting':
      case 'ended':
        return <Play className="w-4 h-4" />;
      case 'playing':
        return <Pause className="w-4 h-4" />;
      case 'paused':
        return <Play className="w-4 h-4" />;
      default:
        return <Square className="w-4 h-4" />;
    }
  };

  const getGameControlText = () => {
    switch (gameStatus) {
      case 'waiting':
        return 'Start Game';
      case 'playing':
        return 'Pause';
      case 'paused':
        return 'Resume';
      case 'ended':
        return 'New Game';
      default:
        return 'Start';
    }
  };

  return (
    <div className={`relative w-full h-screen bg-gray-900 overflow-hidden ${className}`}>
      {/* Main Game Canvas */}
      <div className="absolute inset-0 flex items-center justify-center">
        <GameCanvas width={800} height={600} />
      </div>

      {/* Game HUD */}
      <GameHUD className="absolute inset-0 pointer-events-none" />

      {/* Player Controls */}
      <PlayerControls className="absolute inset-0 pointer-events-none" />

      {/* Left Side UI */}
      <div className="absolute left-4 top-4 space-y-4">
        {/* Game Timer */}
        <GameTimer showControls={true} />
      </div>

      {/* Right Side UI */}
      <div className="absolute right-4 top-4 space-y-4">
        {/* Minimap */}
        <Minimap />
      </div>

      {/* Bottom Right UI */}
      <div className="absolute bottom-4 right-4">
        <ChatOverlay />
      </div>

      {/* Scoreboard Overlay */}
      {showScoreboard && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-40">
          <div className="relative">
            <ScoreBoard showDetailed={true} className="w-96" />
            <button
              onClick={() => setShowScoreboard(false)}
              className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white p-1 rounded-full transition-colors"
            >
              <span className="text-xs">×</span>
            </button>
          </div>
        </div>
      )}

      {/* Game Control Button */}
      <div className="absolute bottom-4 left-4">
        <button
          onClick={handleGameControl}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold transition-colors ${
            gameStatus === 'playing' 
              ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {getGameControlIcon()}
          <span>{getGameControlText()}</span>
        </button>
      </div>

      {/* Settings Button */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2">
        <button
          onClick={() => setShowSettings(true)}
          className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors"
          title="Game Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Game Instructions */}
      {gameStatus === 'waiting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 z-30">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md text-center">
            <h2 className="text-white text-2xl font-bold mb-4">Welcome to ArenaX</h2>
            <div className="text-gray-300 space-y-2 mb-6">
              <p>Use WASD to move your character</p>
              <p>Press SPACE to perform actions</p>
              <p>Press ENTER to open chat</p>
              <p>Press TAB to view scoreboard</p>
              <p>Press ESC to pause and access settings</p>
            </div>
            <button
              onClick={startGame}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Start Playing
            </button>
          </div>
        </div>
      )}

      {/* Settings Overlay */}
      <SettingsOverlay 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />

      {/* Performance Monitor (if enabled) */}
      {useGameStore((state) => state.settings.showFPS) && (
        <div className="absolute top-4 right-4 bg-black bg-opacity-70 text-white p-2 rounded text-xs font-mono">
          <div>FPS: {useGameStore((state) => state.performance.fps)}</div>
          <div>Frame: {useGameStore((state) => state.performance.frameTime.toFixed(2))}ms</div>
        </div>
      )}
    </div>
  );
};
