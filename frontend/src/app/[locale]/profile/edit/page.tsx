'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { CustomizationOptions } from '@/components/profile/CustomizationOptions';
import { validateAvatarFile } from '@/lib/profile-utils';
import { FileUpload } from '@/components/ui/FileUpload';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { CheckCircle, AlertTriangle, Twitter, Github, Twitch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProfileCustomization } from '@/types/profile';
import type { UserProfileUpdate } from '@/types/user';

const MAX_BIO_LENGTH = 500;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;

const DEFAULT_CUSTOMIZATION: ProfileCustomization = {
  banner: 'default',
  colorTheme: 'blue',
};

// Mock usernames for uniqueness check
const existingUsernames = new Set(['ProGamer99', 'EliteSniper', 'ShadowNinja', 'DragonSlayer', 'NightWalker']);

function ProfileEditContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [socialLinks, setSocialLinks] = useState({
    twitter: user?.socialLinks?.twitter ?? '',
    discord: user?.socialLinks?.discord ?? '',
    twitch: user?.socialLinks?.twitch ?? '',
    github: user?.socialLinks?.github ?? '',
  });
  const [customization, setCustomization] = useState<ProfileCustomization>(
    DEFAULT_CUSTOMIZATION
  );

  // Avatar state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Validation state
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);

  // UI state
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track original values for unsaved changes detection
  const originalValues = useRef({
    username: user?.username ?? '',
    bio: user?.bio ?? '',
    socialLinks: {
      twitter: user?.socialLinks?.twitter ?? '',
      discord: user?.socialLinks?.discord ?? '',
      twitch: user?.socialLinks?.twitch ?? '',
      github: user?.socialLinks?.github ?? '',
    },
  });

  const bioTooLong = bio.length > MAX_BIO_LENGTH;
  const usernameInvalid = username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH;

  // Check for unsaved changes
  useEffect(() => {
    const hasChanges =
      username !== originalValues.current.username ||
      bio !== originalValues.current.bio ||
      socialLinks.twitter !== originalValues.current.socialLinks.twitter ||
      socialLinks.discord !== originalValues.current.socialLinks.discord ||
      socialLinks.twitch !== originalValues.current.socialLinks.twitch ||
      socialLinks.github !== originalValues.current.socialLinks.github ||
      avatarFile !== null;

    setHasUnsavedChanges(hasChanges);
  }, [username, bio, socialLinks, avatarFile]);

  // Debounced username uniqueness check
  const checkUsernameAvailability = useCallback(async (value: string) => {
    if (value.length < USERNAME_MIN_LENGTH) {
      setUsernameError(null);
      return;
    }

    if (value === originalValues.current.username) {
      setUsernameError(null);
      return;
    }

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 300));

    if (existingUsernames.has(value)) {
      setUsernameError('This username is already taken');
    } else {
      setUsernameError(null);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (username && username !== originalValues.current.username) {
        checkUsernameAvailability(username);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [username, checkUsernameAvailability]);

  if (!user) {
    router.push('/login');
    return null;
  }

  function handleUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setUsername(value);

    if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
      setUsernameError(`Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters`);
    } else {
      setUsernameError(null);
    }
  }

  function handleBioChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBio(value);
    if (value.length > MAX_BIO_LENGTH) {
      setBioError('Bio must be 500 characters or less');
    } else {
      setBioError(null);
    }
  }

  function handleSocialLinkChange(platform: string, value: string) {
    setSocialLinks(prev => ({ ...prev, [platform]: value }));
  }

  function handleAvatarChange(file: File | null) {
    if (!file) return;

    const result = validateAvatarFile({ size: file.size, type: file.type });
    if (!result.valid) {
      setAvatarError(result.error ?? 'Invalid file. Please check size and type.');
      setAvatarFile(null);
      setAvatarPreview(null);
    } else {
      setAvatarError(null);
      setAvatarFile(file);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  function handleRemoveAvatar() {
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError(null);
    // If the user had a previous avatar, we might want to restore it here
    // setAvatarPreview(user?.avatar ?? null);
  }

  async function handleSubmit() {
    if (bioTooLong || usernameInvalid || usernameError) return;

    setSaving(true);
    setError(null);
    setUploading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      if (avatarFile) {
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => {
            if (prev >= 95) return 95;
            return prev + 10;
          });
        }, 100);
        await new Promise(resolve => setTimeout(resolve, 1000));
        clearInterval(progressInterval);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create update object
      const update: UserProfileUpdate = {};
      if (username !== originalValues.current.username) {
        update.username = username;
      }
      if (bio !== originalValues.current.bio) {
        update.bio = bio;
      }
      if (avatarFile) {
        update.avatar = avatarPreview || undefined;
      }
      if (Object.values(socialLinks).some((v, i) => v !== Object.values(originalValues.current.socialLinks)[i])) {
        update.socialLinks = socialLinks;
      }

      // Update original values
      originalValues.current = {
        username,
        bio,
        socialLinks: { ...socialLinks },
      };

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setHasUnsavedChanges(false);
    } catch (err) {
      setError('Failed to save profile. Please try again.');
    } finally {
      setUploadProgress(100);
      setUploading(false);
      setSaving(false);
    }
  }

  function handleCancel() {
    if (hasUnsavedChanges) {
      setShowUnsavedWarning(true);
    } else {
      router.back();
    }
  }

  function handleConfirmCancel() {
    setShowUnsavedWarning(false);
    router.back();
  }

  function handleDiscardChanges() {
    setUsername(originalValues.current.username);
    setBio(originalValues.current.bio);
    setSocialLinks(originalValues.current.socialLinks);
    setAvatarFile(null);
    setAvatarPreview(user?.avatar ?? null);
    setShowUnsavedWarning(false);
    router.back();
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit Profile</h1>
        {hasUnsavedChanges && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>

      {/* Avatar Section */}
      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
        </CardHeader>
        <CardContent>
          <FileUpload
            file={avatarFile}
            preview={avatarPreview}
            onFileAccepted={handleAvatarChange}
            onRemove={handleRemoveAvatar}
            uploading={uploading && !!avatarFile}
            uploadProgress={uploadProgress}
            accept={{ 'image/jpeg': [], 'image/png': [], 'image/webp': [] }}
            maxSize={5 * 1024 * 1024} // 5MB
            disabled={saving}
          />
          {avatarError && (
            <p className="text-sm text-destructive flex items-center gap-1 mt-2">
              <AlertTriangle className="h-4 w-4" />
              {avatarError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Username Section */}
      <Card>
        <CardHeader>
          <CardTitle>Username</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={username}
            onChange={handleUsernameChange}
            placeholder="Enter your username"
            className={cn(usernameError && 'border-destructive')}
          />
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              {username.length} / {USERNAME_MAX_LENGTH} characters
            </p>
            {username === originalValues.current.username && (
              <span className="text-xs text-success flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Available
              </span>
            )}
          </div>
          {usernameError && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              {usernameError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Bio Section */}
      <Card>
        <CardHeader>
          <CardTitle>Bio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            id="bio"
            aria-label="Bio"
            value={bio}
            onChange={handleBioChange}
            rows={4}
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring",
              bioTooLong && "border-destructive"
            )}
            placeholder="Tell others about yourself..."
          />
          <p className={cn("text-xs text-right", bioTooLong ? "text-destructive" : "text-muted-foreground")}>
            {bio.length} / {MAX_BIO_LENGTH}
          </p>
          {bioError && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              {bioError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Social Links Section */}
      <Card>
        <CardHeader>
          <CardTitle>Social Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="twitter" className="flex items-center gap-2 text-sm font-medium">
              <Twitter className="h-4 w-4" />
              Twitter
            </label>
            <Input
              id="twitter"
              value={socialLinks.twitter}
              onChange={(e) => handleSocialLinkChange('twitter', e.target.value)}
              placeholder="https://twitter.com/username"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="discord" className="flex items-center gap-2 text-sm font-medium">
              <span className="h-4 w-4 bg-indigo-500 rounded-full" />
              Discord
            </label>
            <Input
              id="discord"
              value={socialLinks.discord}
              onChange={(e) => handleSocialLinkChange('discord', e.target.value)}
              placeholder="Username#0000"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="twitch" className="flex items-center gap-2 text-sm font-medium">
              <Twitch className="h-4 w-4" />
              Twitch
            </label>
            <Input
              id="twitch"
              value={socialLinks.twitch}
              onChange={(e) => handleSocialLinkChange('twitch', e.target.value)}
              placeholder="https://twitch.tv/username"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="github" className="flex items-center gap-2 text-sm font-medium">
              <Github className="h-4 w-4" />
              GitHub
            </label>
            <Input
              id="github"
              value={socialLinks.github}
              onChange={(e) => handleSocialLinkChange('github', e.target.value)}
              placeholder="https://github.com/username"
            />
          </div>
        </CardContent>
      </Card>

      {/* Customization */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Customization</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomizationOptions current={customization} onChange={setCustomization} />
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
        <div className="flex items-center gap-2 p-4 bg-success/90 text-white rounded-md">
          <CheckCircle className="h-5 w-5" />
          <p className="text-sm font-medium">Profile saved successfully!</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          onClick={handleSubmit}
          disabled={saving || bioTooLong || usernameInvalid || !!usernameError}
          className="flex-1"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button
          variant="outline"
          onClick={handleCancel}
          className="flex-1"
        >
          Cancel
        </Button>
      </div>

      {/* Unsaved Changes Warning Modal */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle>Unsaved Changes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You have unsaved changes. Are you sure you want to leave?
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowUnsavedWarning(false)}
                  className="flex-1"
                >
                  Keep Editing
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDiscardChanges}
                  className="flex-1"
                >
                  Discard Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ProfileEditPage() {
  return (
    <Suspense>
      <ProfileEditContent />
    </Suspense>
  );
}
