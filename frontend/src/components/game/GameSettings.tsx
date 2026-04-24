'use client';

import { useState } from 'react';

export default function GameSettings() {
  const [settings, setSettings] = useState({
    difficulty: 'medium',
    map: 'default',
    timeLimit: 600,
  });

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 p-6">
      <h3 className="text-xl font-bold text-white mb-4">Game Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-gray-300 text-sm mb-2">Difficulty</label>
          <select
            value={settings.difficulty}
            onChange={(e) => setSettings({ ...settings, difficulty: e.target.value })}
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label className="block text-gray-300 text-sm mb-2">Map</label>
          <select
            value={settings.map}
            onChange={(e) => setSettings({ ...settings, map: e.target.value })}
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white"
          >
            <option value="default">Default</option>
            <option value="arena">Arena</option>
            <option value="forest">Forest</option>
          </select>
        </div>
      </div>
    </div>
  );
}
