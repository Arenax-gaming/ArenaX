'use client'

/**
 * PersonalRank
 *
 * Renders the "Your Rank" block above the leaderboard table.
 * Also exposes a sticky bottom card that becomes visible whenever
 * this component scrolls out of the viewport, letting the user always
 * see their rank and click to scroll back to it.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Trophy, TrendingUp, TrendingDown, Share2, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PersonalRankData {
  rank: number
  eloRating: number
  points: number
  percentile: number
  prevRank?: number
}

interface PersonalRankProps {
  category: string
  season: string
  /** Optional class name for the inline card wrapper */
  className?: string
}

export const PersonalRank: React.FC<PersonalRankProps> = ({ category, season, className }) => {
  const [personalRank, setPersonalRank] = useState<PersonalRankData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Whether the inline card is scrolled out of view
  const [isOutOfView, setIsOutOfView] = useState(false)
  // Whether the row is briefly highlighted after click-to-scroll
  const [isHighlighted, setIsHighlighted] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchPersonalRank = async () => {
      setIsLoading(true)
      try {
        // Simulate API call — replace with usePlayerRank hook when auth is wired
        await new Promise((resolve) => setTimeout(resolve, 300))
        setPersonalRank({
          rank: Math.floor(Math.random() * 1000) + 1,
          eloRating: Math.floor(Math.random() * 2000) + 800,
          points: Math.floor(Math.random() * 50000),
          percentile: Math.floor(Math.random() * 100),
          prevRank: Math.floor(Math.random() * 1000) + 1,
        })
      } catch (error) {
        console.error('Failed to fetch personal rank:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPersonalRank()
  }, [category, season])

  // ── IntersectionObserver: detect when the inline card leaves the viewport ───
  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // entry.isIntersecting === false means the card is not visible
        setIsOutOfView(!(entry?.isIntersecting ?? true))
      },
      { threshold: 0 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [personalRank]) // re-attach after data is loaded and card is rendered

  // ── Scroll-to handler ────────────────────────────────────────────────────────
  const scrollToCard = useCallback(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setIsHighlighted(true)
    setTimeout(() => setIsHighlighted(false), 2000)
  }, [])

  // ── Early returns ────────────────────────────────────────────────────────────
  if (!personalRank && !isLoading) return null

  if (isLoading) {
    return (
      <div className={cn('mb-8 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg p-6 border border-primary/50', className)}>
        <div className="animate-pulse h-20 bg-surface-raised rounded" />
      </div>
    )
  }

  if (!personalRank) return null

  const rankChange = personalRank.prevRank ? personalRank.prevRank - personalRank.rank : 0
  const isRankImproved = rankChange > 0

  const RankDelta = () => {
    if (rankChange === 0) return null
    const Icon = isRankImproved ? TrendingUp : TrendingDown
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-1 text-lg font-bold',
          isRankImproved ? 'text-green-400' : 'text-red-400',
        )}
        aria-label={`Rank ${isRankImproved ? 'improved' : 'dropped'} by ${Math.abs(rankChange)}`}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
        {Math.abs(rankChange)}
      </div>
    )
  }

  return (
    <>
      {/* ── Inline card (always in the DOM so the observer has a target) ── */}
      <div
        ref={cardRef}
        className={cn(
          'mb-8 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg p-6 border transition-all duration-500',
          isHighlighted
            ? 'border-primary ring-2 ring-primary/40 scale-[1.01]'
            : 'border-primary/50',
          className,
        )}
        aria-label="Your rank"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-primary/90 rounded-full p-3">
              <Trophy className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Your Rank</p>
              <h2 className="text-3xl font-bold text-white">#{personalRank.rank}</h2>
            </div>
          </div>

          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">ELO</p>
              <p className="text-2xl font-bold text-white">
                {personalRank.eloRating.toLocaleString()}
              </p>
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">Percentile</p>
              <p className="text-2xl font-bold text-white">
                Top {Math.max(1, 100 - personalRank.percentile)}%
              </p>
            </div>

            {rankChange !== 0 && (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Change</p>
                <RankDelta />
              </div>
            )}
          </div>

          <button
            type="button"
            className="p-2 bg-surface-raised hover:bg-gray-600 rounded-lg text-foreground/80 hover:text-white transition-colors"
            aria-label="Share your rank"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Sticky bottom card — shown only when inline card is out of view ── */}
      {isOutOfView && (
        <button
          type="button"
          aria-label="Your rank — click to scroll into view"
          className={cn(
            'fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40',
            'flex items-center gap-3 px-4 py-3 rounded-full shadow-2xl',
            'bg-gray-900/90 border border-primary/60 backdrop-blur-sm',
            'cursor-pointer hover:bg-gray-800/90 transition-colors',
            'animate-in fade-in slide-in-from-bottom-2 duration-300',
          )}
          onClick={scrollToCard}
        >
          <Trophy className="w-4 h-4 text-yellow-400 shrink-0" aria-hidden="true" />

          <span className="text-sm font-semibold text-white whitespace-nowrap">
            Your Rank: #{personalRank.rank}
          </span>

          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {personalRank.eloRating.toLocaleString()} ELO
          </span>

          {rankChange !== 0 && (
            <span
              className={cn(
                'flex items-center gap-0.5 text-xs font-bold',
                isRankImproved ? 'text-green-400' : 'text-red-400',
              )}
            >
              {isRankImproved ? (
                <TrendingUp className="w-3 h-3" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-3 h-3" aria-hidden="true" />
              )}
              {Math.abs(rankChange)}
            </span>
          )}

          <ArrowUp className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
        </button>
      )}
    </>
  )
}
