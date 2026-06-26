"use client";

/**
 * UnlockAnimation
 *
 * Displays an achievement-unlock overlay.
 * Respects the user's `prefers-reduced-motion` OS setting:
 *   - Full motion: scale + translate entrance + sparkle pings
 *   - Reduced motion: simple fade-in only
 *
 * In both modes the achievement title and rarity are always shown.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { AchievementFull } from '@/data/achievements';
import { RarityIndicator } from './RarityIndicator';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface UnlockAnimationProps {
  achievement: AchievementFull;
  onClose: () => void;
}

export function UnlockAnimation({ achievement, onClose }: UnlockAnimationProps) {
  const [visible, setVisible] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    // Trigger entrance animation
    const t1 = setTimeout(() => setVisible(true), 50);
    // Auto-dismiss after 4 s
    const t2 = setTimeout(() => {
      setVisible(false);
      // Wait for exit transition before unmounting (skipped when reduced motion)
      setTimeout(onClose, prefersReducedMotion ? 0 : 400);
    }, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onClose, prefersReducedMotion]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onClose, prefersReducedMotion ? 0 : 400);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      aria-live="assertive"
      aria-atomic="true"
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40',
          // Always use opacity transition for backdrop (it's subtle enough even with reduced motion)
          'transition-opacity duration-300',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      />

      {/* Card */}
      <div
        className={cn(
          'relative pointer-events-auto max-w-sm w-full mx-4 rounded-2xl border-2 p-6 shadow-2xl',
          'bg-card text-card-foreground',
          // ── Full motion: scale + translate ──────────────────────────────────
          !prefersReducedMotion && 'transition-all duration-400',
          !prefersReducedMotion && (visible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-75 translate-y-8'),
          // ── Reduced motion: fade only ────────────────────────────────────────
          prefersReducedMotion && 'transition-opacity duration-200',
          prefersReducedMotion && (visible ? 'opacity-100' : 'opacity-0'),
          // Rarity border colours
          achievement.rarity === 'legendary' && 'border-yellow-400 shadow-yellow-400/30',
          achievement.rarity === 'epic' && 'border-purple-400 shadow-purple-400/30',
          achievement.rarity === 'rare' && 'border-primary/70 shadow-blue-400/30',
          achievement.rarity === 'common' && 'border-border',
        )}
        role="status"
        aria-label={`Achievement unlocked: ${achievement.title}`}
      >
        {/* Sparkles — suppressed when reduced motion is active */}
        {!prefersReducedMotion &&
          (achievement.rarity === 'legendary' || achievement.rarity === 'epic') && (
            <div
              className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none"
              aria-hidden="true"
            >
              {[...Array(6)].map((_, i) => (
                <span
                  key={i}
                  className="absolute text-lg animate-ping"
                  style={{
                    top: `${10 + i * 15}%`,
                    left: `${5 + i * 16}%`,
                    animationDelay: `${i * 0.2}s`,
                    animationDuration: '1.5s',
                    opacity: 0.6,
                  }}
                >
                  ✦
                </span>
              ))}
            </div>
          )}

        <div className="text-center space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Achievement Unlocked
          </p>

          <div className="text-6xl" aria-hidden="true">
            {achievement.icon}
          </div>

          {/* Title and rarity are always visible regardless of motion preference */}
          <div>
            <h2 className="text-xl font-bold">{achievement.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{achievement.description}</p>
          </div>

          <div className="flex items-center justify-center gap-2">
            <RarityIndicator rarity={achievement.rarity} />
            <span className="text-xs text-muted-foreground">+{achievement.points} pts</span>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
