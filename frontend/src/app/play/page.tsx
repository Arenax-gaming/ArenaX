'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GameModeSelector from '@/components/game/GameModeSelector';
import MatchmakingQueue from '@/components/game/MatchmakingQueue';

export default function PlayPage() {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleStartMatchmaking = (gameMode: string) => {
    setSelectedMode(gameMode);
    setIsSearching(true);
  };

  const handleCancelMatchmaking = () => {
    setIsSearching(false);
    setSelectedMode(null);
  };

  const handleMatchFound = (sessionId: string) => {
    router.push(`/play/lobby?session=${sessionId}`);
  };

  if (isSearching && selectedMode) {
    return (
      <MatchmakingQueue
        gameMode={selectedMode}
        onCancel={handleCancelMatchmaking}
        onMatchFound={handleMatchFound}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">
            Choose Your Battle
          </h1>
          <p className="text-xl text-gray-300">
            Select a game mode and find your opponents
          </p>
        </div>

        <GameModeSelector
          onSelect={handleStartMatchmaking}
          selectedMode={selectedMode}
        />

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <h3 className="text-xl font-bold text-white mb-2">Quick Play</h3>
            <p className="text-gray-300 text-sm">
              Jump into a game instantly with casual matchmaking
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <h3 className="text-xl font-bold text-white mb-2">Ranked Matches</h3>
            <p className="text-gray-300 text-sm">
              Compete in skill-based matches and climb the leaderboard
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <h3 className="text-xl font-bold text-white mb-2">Custom Games</h3>
            <p className="text-gray-300 text-sm">
              Create private lobbies and play with friends
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
