import React, { useMemo } from 'react';
import { Trophy, Medal, Crown, Users } from 'lucide-react';
import { useGameStore } from '@/stores/gameStore';

interface ScoreBoardProps {
  className?: string;
  showDetailed?: boolean;
}

export const ScoreBoard: React.FC<ScoreBoardProps> = ({ 
  className = '',
  showDetailed = false 
}) => {
  const localPlayer = useGameStore((state) => state.localPlayer);
  const players = useGameStore((state) => state.players);
  const gameStatus = useGameStore((state) => state.gameStatus);

  // Combine local player with other players and sort by score
  const sortedPlayers = useMemo(() => {
    const allPlayers = localPlayer ? [localPlayer, ...players] : players;
    return allPlayers.sort((a, b) => b.score - a.score);
  }, [localPlayer, players]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-500" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-400" />;
      case 3:
        return <Medal className="w-5 h-5 text-orange-600" />;
      default:
        return <span className="text-gray-400 font-mono text-sm">#{rank}</span>;
    }
  };

  const getScoreColor = (score: number, isLocal: boolean) => {
    if (isLocal) return 'text-green-400';
    if (score >= 1000) return 'text-yellow-400';
    if (score >= 500) return 'text-blue-400';
    return 'text-gray-300';
  };

  if (sortedPlayers.length === 0) {
    return (
      <div className={`bg-black bg-opacity-70 rounded-lg p-4 ${className}`}>
        <div className="text-gray-400 text-center">No players in game</div>
      </div>
    );
  }

  return (
    <div className={`bg-black bg-opacity-70 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h3 className="text-white font-bold text-lg">Scoreboard</h3>
        </div>
        <div className="flex items-center space-x-1 text-gray-400">
          <Users className="w-4 h-4" />
          <span className="text-sm">{sortedPlayers.length}</span>
        </div>
      </div>

      {/* Player List */}
      <div className="space-y-2">
        {sortedPlayers.map((player, index) => {
          const rank = index + 1;
          const isLocal = player.isLocal;
          
          return (
            <div
              key={player.id}
              className={`flex items-center justify-between p-2 rounded ${
                isLocal 
                  ? 'bg-green-900 bg-opacity-30 border border-green-500' 
                  : 'bg-gray-800 bg-opacity-30'
              }`}
            >
              <div className="flex items-center space-x-3">
                {/* Rank */}
                <div className="flex items-center justify-center w-8">
                  {getRankIcon(rank)}
                </div>

                {/* Player Info */}
                <div className="flex flex-col">
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full border border-gray-600"
                      style={{ backgroundColor: player.color }}
                    />
                    <span className={`font-semibold ${isLocal ? 'text-green-400' : 'text-white'}`}>
                      {player.name}
                      {isLocal && <span className="text-xs ml-1">(You)</span>}
                    </span>
                  </div>
                  
                  {showDetailed && (
                    <div className="text-xs text-gray-400">
                      Health: {player.health}/{player.maxHealth}
                    </div>
                  )}
                </div>
              </div>

              {/* Score */}
              <div className="text-right">
                <div className={`font-bold text-lg ${getScoreColor(player.score, isLocal)}`}>
                  {player.score.toLocaleString()}
                </div>
                {showDetailed && (
                  <div className="text-xs text-gray-400">
                    K/D: 0/0
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Game Status Footer */}
      {gameStatus !== 'playing' && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="text-center text-sm">
            <span className={`font-bold ${
              gameStatus === 'waiting' ? 'text-gray-400' :
              gameStatus === 'paused' ? 'text-yellow-400' :
              gameStatus === 'ended' ? 'text-red-400' :
              'text-green-400'
            }`}>
              {gameStatus === 'waiting' && 'Waiting for players...'}
              {gameStatus === 'paused' && 'Game Paused'}
              {gameStatus === 'ended' && 'Game Ended'}
            </span>
          </div>
        </div>
      )}

      {/* Winner announcement */}
      {gameStatus === 'ended' && sortedPlayers.length > 0 && (
        <div className="mt-4 p-3 bg-yellow-900 bg-opacity-30 rounded-lg border border-yellow-500">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-2">
              <Crown className="w-6 h-6 text-yellow-500" />
              <span className="text-yellow-400 font-bold text-lg">
                {sortedPlayers[0].name} Wins!
              </span>
              <Crown className="w-6 h-6 text-yellow-500" />
            </div>
            <div className="text-yellow-300 text-sm mt-1">
              Final Score: {sortedPlayers[0].score.toLocaleString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
