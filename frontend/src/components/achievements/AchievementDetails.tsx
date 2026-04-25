"use client";

import { useState } from 'react';
import { AchievementFull, CATEGORY_CONFIG } from '@/data/achievements';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ProgressBar } from './ProgressBar';
import { RarityIndicator } from './RarityIndicator';
import { UnlockAnimation } from './UnlockAnimation';
import { cn } from '@/lib/utils';

interface AchievementDetailsProps {
  achievement: AchievementFull;
}

export function AchievementDetails({ achievement }: AchievementDetailsProps) {
  const [showUnlock, setShowUnlock] = useState(false);

  const shareText = achievement.unlocked
    ? `I just unlocked "${achievement.title}" on ArenaX! ${achievement.icon} #ArenaX #Gaming`
    : `I'm ${Math.round((achievement.progress / achievement.total) * 100)}% of the way to "${achievement.title}" on ArenaX! ${achievement.icon}`;

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: achievement.title, text: shareText, url: window.location.href });
    } else {
      await navigator.clipboard.writeText(shareText);
      alert('Copied to clipboard!');
    }
  };

  return (
    <>
      {showUnlock && achievement.unlocked && (
        <UnlockAnimation achievement={achievement} onClose={() => setShowUnlock(false)} />
      )}

      <div className="space-y-6">
        {/* Hero card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className={cn(
                'flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl text-5xl',
                achievement.unlocked ? 'bg-primary/10' : 'bg-muted opacity-50'
              )}>
                {achievement.unlocked ? achievement.icon : '🔒'}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{achievement.title}</h1>
                  <RarityIndicator rarity={achievement.rarity} />
                  {achievement.unlocked && (
                    <span className="rounded-full bg-green-100 dark:bg-green-900 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300">
                      ✓ Unlocked
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">{achievement.description}</p>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>{CATEGORY_CONFIG[achievement.category].icon} {CATEGORY_CONFIG[achievement.category].label}</span>
                  <span>🏅 {achievement.points} points</span>
                  {achievement.unlockedAt && (
                    <span>📅 {new Date(achievement.unlockedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress */}
        {!achievement.unlocked && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressBar value={achievement.progress} max={achievement.total} showLabel animated />
              {achievement.hint && (
                <p className="mt-3 text-sm text-muted-foreground italic">💡 {achievement.hint}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {achievement.requirements.map((req, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={achievement.unlocked ? 'text-green-500' : 'text-muted-foreground'}>
                    {achievement.unlocked ? '✓' : '○'}
                  </span>
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            📤 Share
          </button>
          {achievement.unlocked && (
            <button
              onClick={() => setShowUnlock(true)}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              🎉 Replay Unlock
            </button>
          )}
        </div>
      </div>
    </>
  );
}
