'use client';

import { useState } from 'react';

interface Player {
  id: string;
  username: string;
  avatar?: string;
  isReady: boolean;
  isHost: boolean;
}

interface PartyManagerProps {
  partyId?: string;
  players: Player[];
  maxPlayers?: number;
  onInvite?: (playerId: string) => void;
  onLeave?: () => void;
  onKick?: (playerId: string) => void;
  onStartGame?: () => void;
}

export default function PartyManager({
  partyId,
  players,
  maxPlayers = 4,
  onInvite,
  onLeave,
  onKick,
  onStartGame,
}: PartyManagerProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);

  const isFull = players.length >= maxPlayers;
  const allReady = players.every(p => p.isReady);
  const currentUserId = 'current-user-id'; // Get from auth context
  const isHost = players.find(p => p.id === currentUserId)?.isHost;

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-white">Party</h3>
          {partyId && (
            <p className="text-sm text-gray-400">ID: {partyId}</p>
          )}
        </div>
        <div className="text-purple-400 font-semibold">
          {players.length}/{maxPlayers}
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {players.map((player) => (
          <div
            key={player.id}
            className="flex items-center justify-between bg-gray-800/50 rounded-lg p-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <span className="text-white font-bold">
                  {player.username.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-white font-semibold">{player.username}</p>
                {player.isHost && (
                  <span className="text-xs text-yellow-400">Host</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  player.isReady ? 'bg-green-500' : 'bg-gray-500'
                }`}
              />
              {isHost && player.id !== currentUserId && (
                <button
                  onClick={() => onKick?.(player.id)}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Kick
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setShowInviteModal(true)}
          disabled={isFull}
          className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-50 text-purple-400 rounded-lg transition-colors border border-purple-500/30"
        >
          Invite Player
        </button>
        <button
          onClick={onLeave}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors border border-red-500/30"
        >
          Leave Party
        </button>
      </div>

      {isHost && (
        <button
          onClick={onStartGame}
          disabled={!allReady || players.length < 2}
          className="w-full mt-3 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all"
        >
          {allReady ? 'Start Game' : 'Waiting for players...'}
        </button>
      )}
    </div>
  );
}
