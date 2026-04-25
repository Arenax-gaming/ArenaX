'use client';

import { useEffect, useState } from 'react';
import PartyManager from '@/components/game/PartyManager';
import ChatPanel from '@/components/game/ChatPanel';
import GameSettings from '@/components/game/GameSettings';
import CountdownTimer from '@/components/game/CountdownTimer';

interface Player {
  id: string;
  username: string;
  isReady: boolean;
  isHost: boolean;
}

export default function LobbyPage() {
  const [sessionId, setSessionId] = useState<string>('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) {
      setSessionId(session);
      // Mock players - replace with actual API call
      setPlayers([
        { id: '1', username: 'Player1', isReady: true, isHost: true },
        { id: '2', username: 'Player2', isReady: false, isHost: false },
      ]);
    }
  }, []);

  const handleStartGame = () => {
    setCountdown(5);
  };

  const handleCountdownComplete = () => {
    // Navigate to game session
    window.location.href = `/game/${sessionId}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Game Lobby</h1>
          <p className="text-gray-300">Session: {sessionId}</p>
        </div>

        {countdown ? (
          <CountdownTimer
            seconds={countdown}
            onComplete={handleCountdownComplete}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PartyManager
                players={players}
                maxPlayers={4}
                onStartGame={handleStartGame}
              />
            </div>
            <div className="space-y-6">
              <GameSettings />
              <ChatPanel roomId={sessionId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
