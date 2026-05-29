'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { 
  Shield, 
  Eye, 
  Users, 
  Trophy, 
  Activity, 
  BarChart3, 
  History,
  Bell,
  Mail,
  CheckCircle,
  AlertTriangle,
  ArrowLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PrivacySettings, PrivacySetting } from '@/types/profile';

const DEFAULT_PRIVACY: PrivacySettings = {
  stats: 'everyone',
  matchHistory: 'everyone',
  achievements: 'everyone',
  friends: 'everyone',
  activityFeed: 'everyone',
};

const DEFAULT_NOTIFICATIONS = {
  friendRequests: true,
  messages: true,
  matchInvites: true,
  tournamentUpdates: true,
  achievementUnlocks: true,
  weeklyReports: false,
  marketingEmails: false,
};

const PRIVACY_SECTIONS: { 
  key: keyof PrivacySettings; 
  label: string; 
  description: string;
  icon: React.ReactNode;
}[] = [
  { 
    key: 'stats', 
    label: 'Statistics', 
    description: 'ELO rating, win/loss record, and performance metrics',
    icon: <BarChart3 className="h-4 w-4" />
  },
  { 
    key: 'matchHistory', 
    label: 'Match History', 
    description: 'Past games, opponents, and match results',
    icon: <History className="h-4 w-4" />
  },
  { 
    key: 'achievements', 
    label: 'Achievements', 
    description: 'Unlocked achievements and progress tracking',
    icon: <Trophy className="h-4 w-4" />
  },
  { 
    key: 'friends', 
    label: 'Friends List', 
    description: 'Your friends and their online status',
    icon: <Users className="h-4 w-4" />
  },
  { 
    key: 'activityFeed', 
    label: 'Activity Feed', 
    description: 'Recent activities and game events',
    icon: <Activity className="h-4 w-4" />
  },
];

const PRIVACY_OPTIONS: { value: PrivacySetting; label: string; description: string }[] = [
  { 
    value: 'everyone', 
    label: 'Everyone', 
    description: 'Visible to all users' 
  },
  { 
    value: 'friends', 
    label: 'Friends Only', 
    description: 'Only visible to your friends' 
  },
  { 
    value: 'only_me', 
    label: 'Only Me', 
    description: 'Only visible to you' 
  },
];

const NOTIFICATION_SECTIONS: {
  key: keyof typeof DEFAULT_NOTIFICATIONS;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'friendRequests',
    label: 'Friend Requests',
    description: 'When someone sends you a friend request',
    icon: <Users className="h-4 w-4" />
  },
  {
    key: 'messages',
    label: 'Messages',
    description: 'When you receive a new message',
    icon: <Mail className="h-4 w-4" />
  },
  {
    key: 'matchInvites',
    label: 'Match Invites',
    description: 'When someone invites you to a match',
    icon: <Activity className="h-4 w-4" />
  },
  {
    key: 'tournamentUpdates',
    label: 'Tournament Updates',
    description: 'Updates about tournaments you\'ve joined',
    icon: <Trophy className="h-4 w-4" />
  },
  {
    key: 'achievementUnlocks',
    label: 'Achievement Unlocks',
    description: 'When you unlock new achievements',
    icon: <Trophy className="h-4 w-4" />
  },
  {
    key: 'weeklyReports',
    label: 'Weekly Reports',
    description: 'Weekly performance and activity summaries',
    icon: <BarChart3 className="h-4 w-4" />
  },
  {
    key: 'marketingEmails',
    label: 'Marketing Emails',
    description: 'Updates about new features and promotions',
    icon: <Bell className="h-4 w-4" />
  },
];

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY);
  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  if (!user) {
    router.push('/login');
    return null;
  }

  function handlePrivacyChange(key: keyof PrivacySettings, value: PrivacySetting) {
    setPrivacy(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }

  function handleNotificationChange(key: keyof typeof DEFAULT_NOTIFICATIONS, value: boolean) {
    setNotifications(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setPrivacy(DEFAULT_PRIVACY);
    setNotifications(DEFAULT_NOTIFICATIONS);
    setHasChanges(false);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="p-2"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Profile Settings</h1>
          <p className="text-muted-foreground">
            Manage your privacy and notification preferences
          </p>
        </div>
      </div>

      {/* Privacy Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Privacy Settings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Control who can see different parts of your profile
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {PRIVACY_SECTIONS.map(({ key, label, description, icon }) => (
            <div key={key} className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-1 text-muted-foreground">
                  {icon}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{label}</div>
                  <div className="text-sm text-muted-foreground">{description}</div>
                </div>
              </div>
              
              <div className="ml-7 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {PRIVACY_OPTIONS.map(option => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/50",
                      privacy[key] === option.value 
                        ? "border-primary bg-primary/5" 
                        : "border-border"
                    )}
                  >
                    <input
                      type="radio"
                      name={`privacy-${key}`}
                      value={option.value}
                      checked={privacy[key] === option.value}
                      onChange={e => handlePrivacyChange(key, e.target.value as PrivacySetting)}
                      className="sr-only"
                    />
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                      privacy[key] === option.value 
                        ? "border-primary" 
                        : "border-muted-foreground"
                    )}>
                      {privacy[key] === option.value && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Settings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose what notifications you want to receive
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {NOTIFICATION_SECTIONS.map(({ key, label, description, icon }) => (
            <div key={key} className="flex items-center justify-between gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-start gap-3 flex-1">
                <div className="mt-1 text-muted-foreground">
                  {icon}
                </div>
                <div>
                  <div className="font-medium">{label}</div>
                  <div className="text-sm text-muted-foreground">{description}</div>
                </div>
              </div>
              <Switch
                checked={notifications[key]}
                onCheckedChange={(checked) => handleNotificationChange(key, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Privacy Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Privacy Tips
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <p>
                <strong>Everyone:</strong> Your information is visible to all ArenaX users, including those not on your friends list.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <p>
                <strong>Friends Only:</strong> Only users you&apos;ve added as friends can see this information.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
              <p>
                <strong>Only Me:</strong> This information is completely private and only visible to you.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive rounded-md text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {saved && (
        <div className="flex items-center gap-2 p-4 bg-green-600 text-white rounded-md">
          <CheckCircle className="h-5 w-5" />
          <p className="text-sm font-medium">Settings saved successfully!</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="flex-1"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={!hasChanges}
          className="flex-1"
        >
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
