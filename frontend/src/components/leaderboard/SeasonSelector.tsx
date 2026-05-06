'use client'

import React from 'react'

interface SeasonSelectorProps {
  season: string
  onChange: (season: string) => void
}

const seasons = [
  { id: 'current', label: 'Current Season' },
  { id: 'season-5', label: 'Season 5' },
  { id: 'season-4', label: 'Season 4' },
  { id: 'season-3', label: 'Season 3' },
  { id: 'season-2', label: 'Season 2' },
  { id: 'season-1', label: 'Season 1' },
  { id: 'all-time', label: 'All Time' },
]

export const SeasonSelector: React.FC<SeasonSelectorProps> = ({
  season,
  onChange,
}) => {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Season</h3>
      <select
        value={season}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {seasons.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
