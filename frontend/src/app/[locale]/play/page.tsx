'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GameModeSelector from '@/components/game/GameModeSelector';
import MatchmakingQueue from '@/components/game/MatchmakingQueue';
import SkillQuickAccessBar from '@/components/game/SkillQuickAccessBar';
import MobileGameControls from '@/components/game/MobileGameControls';
import { useSettings } from '@/hooks/useSettings';

export default function PlayPage() {
  const router = useRouter();
  const { settings } = useSettings();
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
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-foreground mb-4">
            Choose Your Battle
          </h1>
          <p className="text-xl text-foreground/80">
            Select a game mode and find your opponents
          </p>
        </div>

        <GameModeSelector
          onSelect={handleStartMatchmaking}
          selectedMode={selectedMode}
        />

        <div className="mt-8">
          <h2 className="text-xl font-bold text-foreground mb-3 text-center">Skill Quick-Access Bar</h2>
          <SkillQuickAccessBar keyBindings={settings.game.controls} />
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card/60 backdrop-blur-lg rounded-xl p-6 border border-border">
            <h3 className="text-xl font-bold text-foreground mb-2">Quick Play</h3>
            <p className="text-foreground/80 text-sm">
              Jump into a game instantly with casual matchmaking
            </p>
          </div>
          <div className="bg-card/60 backdrop-blur-lg rounded-xl p-6 border border-border">
            <h3 className="text-xl font-bold text-foreground mb-2">Ranked Matches</h3>
            <p className="text-foreground/80 text-sm">
              Compete in skill-based matches and climb the leaderboard
            </p>
          </div>
          <div className="bg-card/60 backdrop-blur-lg rounded-xl p-6 border border-border">
            <h3 className="text-xl font-bold text-foreground mb-2">Custom Games</h3>
            <p className="text-foreground/80 text-sm">
              Create private lobbies and play with friends
            </p>
          </div>
        </div>
      </div>
      <MobileGameControls />
    </div>
  );
}
