'use client'

import React, { useState, useEffect } from 'react'
import { LeaderboardTable, type LeaderboardEntry } from '@/components/leaderboard/LeaderboardTable'
import { CategorySelector } from '@/components/leaderboard/CategorySelector'
import { SeasonSelector } from '@/components/leaderboard/SeasonSelector'
import { PersonalRank } from '@/components/leaderboard/PersonalRank'

export default function LeaderboardsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [category, setCategory] = useState<'global' | 'tournaments' | 'casual'>('global')
  const [season, setSeason] = useState('current')
  const [sortBy, setSortBy] = useState<'points' | 'wins' | 'winRate'>('points')

  useEffect(() => {
    // Fetch leaderboard data
    const fetchLeaderboard = async () => {
      setIsLoading(true)
      try {
        // Simulate API call
        const mockData: LeaderboardEntry[] = Array.from({ length: 100 }, (_, i) => ({
          rank: i + 1,
          userId: `user-${i}`,
          username: `Player${i + 1}`,
          points: Math.max(0, 10000 - i * 100 + Math.random() * 500),
          wins: Math.floor(Math.random() * 500),
          winRate: 0.4 + Math.random() * 0.4,
          lastUpdated: new Date(),
          trend: Math.random() > 0.5 ? 'up' : Math.random() > 0.5 ? 'down' : 'stable',
        }))

        setEntries(mockData)
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchLeaderboard()
  }, [category, season])

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Leaderboards</h1>
          <p className="text-gray-400">Compete and climb the ranks</p>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <CategorySelector
            category={category}
            onChange={setCategory}
          />
          <SeasonSelector
            season={season}
            onChange={setSeason}
          />
        </div>

        {/* Personal Rank */}
        <PersonalRank
          category={category}
          season={season}
        />

        {/* Leaderboard Table */}
        <div className="bg-gray-800/50 rounded-lg p-6 backdrop-blur border border-gray-700">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">
              {category === 'global'
                ? 'Global Rankings'
                : category === 'tournaments'
                  ? 'Tournament Rankings'
                  : 'Casual Rankings'}
            </h2>
            <div className="text-sm text-gray-400">
              Season: {season === 'current' ? 'Current' : `Season ${season}`}
            </div>
          </div>

          <LeaderboardTable
            entries={entries}
            isLoading={isLoading}
            sortBy={sortBy}
            onSortChange={(col) => setSortBy(col as any)}
          />
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="mt-8 text-center text-gray-400">
            Loading leaderboard data...
          </div>
        )}
      </div>
    </div>
  )
}
