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
          <label htmlFor="difficulty" className="block text-foreground/80 text-sm mb-2">Difficulty</label>
          <select
            id="difficulty"
            value={settings.difficulty}
            onChange={(e) => setSettings({ ...settings, difficulty: e.target.value })}
            className="w-full px-4 py-2 bg-surface/50 border border-border rounded-lg text-white"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label htmlFor="map" className="block text-foreground/80 text-sm mb-2">Map</label>
          <select
            id="map"
            value={settings.map}
            onChange={(e) => setSettings({ ...settings, map: e.target.value })}
            className="w-full px-4 py-2 bg-surface/50 border border-border rounded-lg text-white"
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
