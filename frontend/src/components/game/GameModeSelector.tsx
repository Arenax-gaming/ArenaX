'use client';

import { useState } from 'react';

interface GameMode {
  id: string;
  name: string;
  description: string;
  icon: string;
  players: string;
  difficulty: string;
  image: string;
}

const gameModes: GameMode[] = [
  {
    id: '1v1',
    name: '1v1 Duel',
    description: 'Face off in intense head-to-head combat',
    icon: '⚔️',
    players: '2 players',
    difficulty: 'Medium',
    image: '/images/modes/1v1.jpg',
  },
  {
    id: '2v2',
    name: '2v2 Team Battle',
    description: 'Team up with a partner for strategic gameplay',
    icon: '👥',
    players: '4 players',
    difficulty: 'Hard',
    image: '/images/modes/2v2.jpg',
  },
  {
    id: 'battle-royale',
    name: 'Battle Royale',
    description: 'Last player standing wins in this free-for-all',
    icon: '🏆',
    players: '100 players',
    difficulty: 'Expert',
    image: '/images/modes/br.jpg',
  },
  {
    id: 'ranked',
    name: 'Ranked Match',
    description: 'Competitive matchmaking with skill-based ranking',
    icon: '🎯',
    players: '2-4 players',
    difficulty: 'Variable',
    image: '/images/modes/ranked.jpg',
  },
  {
    id: 'casual',
    name: 'Casual Play',
    description: 'Relaxed gameplay with no ranking impact',
    icon: '🎮',
    players: '2-8 players',
    difficulty: 'Easy',
    image: '/images/modes/casual.jpg',
  },
  {
    id: 'custom',
    name: 'Custom Game',
    description: 'Create your own lobby with custom rules',
    icon: '⚙️',
    players: '2-16 players',
    difficulty: 'Custom',
    image: '/images/modes/custom.jpg',
  },
];

interface GameModeSelectorProps {
  onSelect: (gameMode: string) => void;
  selectedMode: string | null;
}

export default function GameModeSelector({ onSelect, selectedMode }: GameModeSelectorProps) {
  const [hoveredMode, setHoveredMode] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {gameModes.map((mode) => (
        <div
          key={mode.id}
          onClick={() => onSelect(mode.id)}
          onMouseEnter={() => setHoveredMode(mode.id)}
          onMouseLeave={() => setHoveredMode(null)}
          className={`
            relative overflow-hidden rounded-xl cursor-pointer transition-all duration-300 transform
            ${selectedMode === mode.id 
              ? 'ring-4 ring-purple-500 scale-105 shadow-2xl shadow-purple-500/50' 
              : 'hover:scale-105 hover:shadow-xl'
            }
          `}
        >
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 border border-gray-700 h-full">
            <div className="text-5xl mb-4">{mode.icon}</div>
            <h3 className="text-2xl font-bold text-white mb-2">{mode.name}</h3>
            <p className="text-gray-400 mb-4">{mode.description}</p>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300 bg-gray-700 px-3 py-1 rounded-full">
                {mode.players}
              </span>
              <span className="text-purple-400 font-semibold">
                {mode.difficulty}
              </span>
            </div>

            {hoveredMode === mode.id && (
              <div className="absolute inset-0 bg-purple-500/10 transition-all duration-300" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
