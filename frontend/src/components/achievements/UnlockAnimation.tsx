"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { AchievementFull } from '@/data/achievements';
import { RarityIndicator } from './RarityIndicator';

interface UnlockAnimationProps {
  achievement: AchievementFull;
  onClose: () => void;
}

export function UnlockAnimation({ achievement, onClose }: UnlockAnimationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    const t1 = setTimeout(() => setVisible(true), 50);
    // Auto-dismiss after 4s
    const t2 = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 400);
    }, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      aria-live="assertive"
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40 transition-opacity duration-300',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      />

      {/* Card */}
      <div
        className={cn(
          'relative pointer-events-auto max-w-sm w-full mx-4 rounded-2xl border-2 p-6 shadow-2xl',
          'bg-card text-card-foreground',
          'transition-all duration-400',
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-75 translate-y-8',
          achievement.rarity === 'legendary' && 'border-yellow-400 shadow-yellow-400/30',
          achievement.rarity === 'epic' && 'border-purple-400 shadow-purple-400/30',
          achievement.rarity === 'rare' && 'border-blue-400 shadow-blue-400/30',
          achievement.rarity === 'common' && 'border-gray-300',
        )}
      >
        {/* Sparkles for legendary/epic */}
        {(achievement.rarity === 'legendary' || achievement.rarity === 'epic') && (
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
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
          <div className="text-6xl">{achievement.icon}</div>
          <div>
            <h2 className="text-xl font-bold">{achievement.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{achievement.description}</p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <RarityIndicator rarity={achievement.rarity} />
            <span className="text-xs text-muted-foreground">+{achievement.points} pts</span>
          </div>
          <button
            onClick={() => { setVisible(false); setTimeout(onClose, 400); }}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
