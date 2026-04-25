'use client';

export default function PlayerList({ players }: { players: any[] }) {
  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 p-6">
      <h3 className="text-xl font-bold text-white mb-4">Players</h3>
      <div className="space-y-2">
        {players.map((player) => (
          <div key={player.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
              <span className="text-white">{player.username}</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${player.isReady ? 'bg-green-500' : 'bg-gray-500'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
