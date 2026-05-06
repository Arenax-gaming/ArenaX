'use client'

import React, { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

export interface LeaderboardEntry {
  rank: number
  userId: string
  username: string
  avatar?: string
  points: number
  wins: number
  winRate: number
  lastUpdated: Date
  trend?: 'up' | 'down' | 'stable'
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[]
  isLoading?: boolean
  sortBy?: 'points' | 'wins' | 'winRate'
  onSortChange?: (sortBy: string) => void
}

export const LeaderboardTable: React.FC<LeaderboardTableProps> = ({
  entries,
  isLoading = false,
  sortBy = 'points',
  onSortChange,
}) => {
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const sortedEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'points':
          comparison = a.points - b.points
          break
        case 'wins':
          comparison = a.wins - b.wins
          break
        case 'winRate':
          comparison = a.winRate - b.winRate
          break
        default:
          comparison = a.points - b.points
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }))
  }, [entries, sortBy, sortDirection])

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortDirection('desc')
      onSortChange?.(column)
    }
  }

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) {
      return <div className="w-4 h-4" />
    }
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">
              Rank
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">
              Player
            </th>
            <th
              className="px-4 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => handleSort('points')}
            >
              <div className="flex items-center justify-end gap-2">
                Points
                <SortIcon column="points" />
              </div>
            </th>
            <th
              className="px-4 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => handleSort('wins')}
            >
              <div className="flex items-center justify-end gap-2">
                Wins
                <SortIcon column="wins" />
              </div>
            </th>
            <th
              className="px-4 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => handleSort('winRate')}
            >
              <div className="flex items-center justify-end gap-2">
                Win Rate
                <SortIcon column="winRate" />
              </div>
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
              Trend
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry, index) => (
            <tr
              key={entry.userId}
              className={`border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50 ${
                index % 2 === 0 ? 'bg-white dark:bg-gray-950' : 'bg-gray-50 dark:bg-gray-900/20'
              }`}
            >
              <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                #{entry.rank}
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  {entry.avatar && (
                    <img
                      src={entry.avatar}
                      alt={entry.username}
                      className="w-8 h-8 rounded-full"
                    />
                  )}
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {entry.username}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">
                {entry.points.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">
                {entry.wins}
              </td>
              <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">
                {(entry.winRate * 100).toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-center">
                {entry.trend === 'up' && (
                  <ChevronUp className="w-5 h-5 text-green-500 mx-auto" />
                )}
                {entry.trend === 'down' && (
                  <ChevronDown className="w-5 h-5 text-red-500 mx-auto" />
                )}
                {entry.trend === 'stable' && (
                  <div className="w-5 h-5 mx-auto text-gray-400">—</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sortedEntries.length === 0 && !isLoading && (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
          No leaderboard entries found
        </div>
      )}
    </div>
  )
}
