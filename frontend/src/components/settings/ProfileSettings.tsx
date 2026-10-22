"use client";

/**
 * Profile settings (Issue #1396): avatar and notification preferences.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useAuth } from "@/hooks/useAuth";
import { AvatarUpload } from "./AvatarUpload";
import { NotificationPreferencesMatrix } from "./NotificationPreferencesMatrix";

export function ProfileSettings() {
  const { user } = useAuth();
  const avatar = (user as { avatar?: string; avatar_url?: string } | null)?.avatar ??
    (user as { avatar_url?: string } | null)?.avatar_url;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
          <CardDescription>Shown on your profile, in lobbies, and on leaderboards.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUpload avatarUrl={avatar} username={user?.username} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose, for each kind of event, whether you hear about it by email, push, or in the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesMatrix />
        </CardContent>
      </Card>
    </div>
  );
}

export default ProfileSettings;
