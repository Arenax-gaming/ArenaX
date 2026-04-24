'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import type { PrivacySettings, PrivacySetting } from '@/types/profile';

const DEFAULT_PRIVACY: PrivacySettings = {
  stats: 'everyone',
  matchHistory: 'everyone',
  achievements: 'everyone',
  friends: 'everyone',
  activityFeed: 'everyone',
};

const SECTIONS: { key: keyof PrivacySettings; label: string }[] = [
  { key: 'stats', label: 'Stats' },
  { key: 'matchHistory', label: 'Match History' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'friends', label: 'Friends' },
  { key: 'activityFeed', label: 'Activity Feed' },
];

const OPTIONS: { value: PrivacySetting; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends Only' },
  { value: 'only_me', label: 'Only Me' },
];

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY);
  const [saved, setSaved] = useState(false);

  if (!user) {
    router.push('/login');
    return null;
  }

  function handleChange(key: keyof PrivacySettings, value: PrivacySetting) {
    setPrivacy(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Privacy Settings</h1>

      <div className="space-y-4">
        {SECTIONS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <label htmlFor={`privacy-${key}`} className="text-sm font-medium">
              {label}
            </label>
            <select
              id={`privacy-${key}`}
              value={privacy[key]}
              onChange={e => handleChange(key, e.target.value as PrivacySetting)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
      >
        Save Settings
      </button>

      {saved && (
        <div
          role="status"
          className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2 rounded-md shadow-lg"
        >
          Settings saved!
        </div>
      )}
    </div>
  );
}
