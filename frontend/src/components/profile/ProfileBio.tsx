"use client";

import React, { useState } from "react";
import { User } from "@/types/user";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Edit2, Twitter, Github, Twitch, ExternalLink, Save, X } from "lucide-react";

interface ProfileBioProps {
  user: User;
  onSave: (updatedUser: Partial<User>) => void;
}

export function ProfileBio({ user, onSave }: ProfileBioProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [bio, setBio] = useState(user.bio || "");
  const [twitter, setTwitter] = useState(user.socialLinks?.twitter || "");
  const [discord, setDiscord] = useState(user.socialLinks?.discord || "");
  const [twitch, setTwitch] = useState(user.socialLinks?.twitch || "");

  const handleSave = () => {
    onSave({
      bio,
      socialLinks: {
        ...user.socialLinks,
        twitter,
        discord,
        twitch,
      },
    });
    setIsEditing(false);
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">About Me</CardTitle>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            <Edit2 className="h-4 w-4 mr-2" />
            Edit Profile
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Bio</label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Twitter className="h-4 w-4" /> Twitter URL
                </label>
                <Input
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="https://twitter.com/..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                   Twitch URL
                </label>
                <Input
                  value={twitch}
                  onChange={(e) => setTwitch(e.target.value)}
                  placeholder="https://twitch.tv/..."
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground leading-relaxed italic">
              "{user.bio || "No bio set yet."}"
            </p>
            <div className="flex flex-wrap gap-3">
              {user.socialLinks?.twitter && (
                <a
                  href={user.socialLinks.twitter}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-xs bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-full transition-colors"
                >
                  <Twitter className="h-3 w-3 text-sky-500" />
                  Twitter
                </a>
              )}
              {user.socialLinks?.twitch && (
                <a
                  href={user.socialLinks.twitch}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-xs bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-full transition-colors"
                >
                  <Twitch className="h-3 w-3 text-purple-500" />
                  Twitch
                </a>
              )}
              {user.socialLinks?.discord && (
                <div className="flex items-center gap-2 text-xs bg-muted px-3 py-1.5 rounded-full">
                  <span className="font-semibold text-indigo-500">Discord:</span>
                  {user.socialLinks.discord}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
      {isEditing && (
        <CardFooter className="flex justify-end gap-2 pt-0">
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
