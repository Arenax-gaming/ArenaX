'use client'

import React, { useState, useEffect } from 'react'
import { Trophy, TrendingUp, Share2 } from 'lucide-react'

interface PersonalRankProps {
  category: string
  season: string
}

export const PersonalRank: React.FC<PersonalRankProps> = ({ category, season }) => {
  const [personalRank, setPersonalRank] = useState<{
    rank: number
    points: number
    percentile: number
    prevRank?: number
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const fetchPersonalRank = async () => {
      setIsLoading(true)
      try {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 300))
        setPersonalRank({
          rank: Math.floor(Math.random() * 1000),
          points: Math.floor(Math.random() * 50000),
          percentile: Math.floor(Math.random() * 100),
          prevRank: Math.floor(Math.random() * 1000),
        })
      } catch (error) {
        console.error('Failed to fetch personal rank:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPersonalRank()
  }, [category, season])

  if (!personalRank && !isLoading) {
    return null
  }

  if (isLoading) {
    return (
      <div className="mb-8 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg p-6 border border-blue-500/50">
        <div className="animate-pulse h-20 bg-gray-700 rounded"></div>
      </div>
    )
  }

  if (!personalRank) {
    return null
  }

  const rankChange = personalRank.prevRank
    ? personalRank.prevRank - personalRank.rank
    : 0
  const isRankImproved = rankChange > 0

  return (
    <div className="mb-8 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg p-6 border border-blue-500/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 rounded-full p-3">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Your Rank</p>
            <h2 className="text-3xl font-bold text-white">#{personalRank.rank}</h2>
          </div>
        </div>

        <div className="flex gap-6">
          <div className="text-center">
            <p className="text-sm text-gray-400">Points</p>
            <p className="text-2xl font-bold text-white">
              {personalRank.points.toLocaleString()}
            </p>
          </div>

          <div className="text-center">
            <p className="text-sm text-gray-400">Percentile</p>
            <p className="text-2xl font-bold text-white">
              Top {Math.max(1, 100 - personalRank.percentile)}%
            </p>
          </div>

          {rankChange !== 0 && (
            <div className="text-center">
              <p className="text-sm text-gray-400">Change</p>
              <div
                className={`flex items-center justify-center gap-1 text-lg font-bold ${
                  isRankImproved ? 'text-green-400' : 'text-red-400'
                }`}
              >
                <TrendingUp
                  className={`w-5 h-5 ${
                    isRankImproved ? '' : 'rotate-180 transform'
                  }`}
                />
                {Math.abs(rankChange)}
              </div>
            </div>
          )}
        </div>

        <button className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 hover:text-white transition-colors">
          <Share2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
