'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { CustomizationOptions } from '@/components/profile/CustomizationOptions';
import { validateAvatarFile } from '@/lib/profile-utils';
import type { ProfileCustomization } from '@/types/profile';

const MAX_BIO_LENGTH = 500;

const DEFAULT_CUSTOMIZATION: ProfileCustomization = {
  banner: 'default',
  colorTheme: 'blue',
};

export default function ProfileEditPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [bio, setBio] = useState(user?.bio ?? '');
  const [customization, setCustomization] = useState<ProfileCustomization>(
    DEFAULT_CUSTOMIZATION
  );
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) {
    router.push('/login');
    return null;
  }

  const bioTooLong = bio.length > MAX_BIO_LENGTH;

  function handleBioChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBio(value);
    if (value.length > MAX_BIO_LENGTH) {
      setBioError('Bio must be 500 characters or less');
    } else {
      setBioError(null);
    }
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = validateAvatarFile({ size: file.size, type: file.type });
    if (!result.valid) {
      setAvatarError(result.error ?? 'Invalid file');
    } else {
      setAvatarError(null);
    }
  }

  function handleSubmit() {
    if (bioTooLong) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function handleCancel() {
    router.back();
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Edit Profile</h1>

      {/* Bio */}
      <div className="space-y-2">
        <label htmlFor="bio" className="block text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={handleBioChange}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Tell others about yourself..."
        />
        <p className={`text-xs text-right ${bioTooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
          {bio.length} / {MAX_BIO_LENGTH}
        </p>
        {bioError && (
          <p className="text-sm text-destructive" role="alert">
            {bioError}
          </p>
        )}
      </div>

      {/* Avatar Upload */}
      <div className="space-y-2">
        <label htmlFor="avatar" className="block text-sm font-medium">
          Avatar
        </label>
        <input
          id="avatar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarChange}
          className="block text-sm"
        />
        {avatarError && (
          <p className="text-sm text-destructive" role="alert">
            {avatarError}
          </p>
        )}
      </div>

      {/* Customization */}
      <CustomizationOptions current={customization} onChange={setCustomization} />

      {/* Success toast */}
      {saved && (
        <div
          role="status"
          className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2 rounded-md shadow-lg"
        >
          Profile saved!
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={bioTooLong}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 rounded-md border text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
