"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { CheckCircle, AlertTriangle, Twitter, Github, Twitch } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { useFormAnalytics } from "@/hooks/useFormAnalytics";
import { validateAvatarFile } from "@/lib/profile-utils";
import { profileEditSchema, type ProfileEditFormData } from "@/lib/validations/profile";
import type { UserProfileUpdate } from "@/types/user";
import type { ProfileCustomization } from "@/types/profile";
import { FileUpload } from "@/components/ui/FileUpload";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { CustomizationOptions } from "@/components/profile/CustomizationOptions";
import { cn } from "@/lib/utils";

const DEFAULT_CUSTOMIZATION: ProfileCustomization = {
  banner: "default",
  colorTheme: "blue",
};

// Mock existing usernames for uniqueness check
const existingUsernames = new Set([
  "ProGamer99",
  "EliteSniper",
  "ShadowNinja",
  "DragonSlayer",
  "NightWalker",
]);

function ProfileEditContent() {
  const { user } = useAuth();
  const router = useRouter();
  const analytics = useFormAnalytics("profile-edit");

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user?.avatar ?? null
  );
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [customization, setCustomization] = useState<ProfileCustomization>(
    DEFAULT_CUSTOMIZATION
  );
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  const form = useForm<ProfileEditFormData>({
    resolver: zodResolver(profileEditSchema),
    defaultValues: {
      username: user?.username ?? "",
      bio: user?.bio ?? "",
      twitter: user?.socialLinks?.twitter ?? "",
      discord: user?.socialLinks?.discord ?? "",
      twitch: user?.socialLinks?.twitch ?? "",
      github: user?.socialLinks?.github ?? "",
    },
    mode: "onTouched",
  });

  const watchedUsername = form.watch("username");
  const watchedBio = form.watch("bio") ?? "";
  const usernameStatus = useUsernameAvailability(watchedUsername);

  // Surface async username check into RHF
  useEffect(() => {
    if (usernameStatus === "unavailable") {
      form.setError("username", { message: "This username is already taken" });
    } else if (usernameStatus === "error") {
      form.setError("username", {
        message: "Could not verify username availability. Please try again.",
      });
    } else if (
      usernameStatus === "available" &&
      (form.formState.errors.username?.message === "This username is already taken" ||
        form.formState.errors.username?.message?.includes("verify"))
    ) {
      form.clearErrors("username");
    }
  }, [usernameStatus, form]);

  if (!user) {
    router.push("/login");
    return null;
  }

  const isDirty =
    form.formState.isDirty ||
    avatarFile !== null;

  function handleAvatarChange(file: File | null) {
    if (!file) return;
    const result = validateAvatarFile({ size: file.size, type: file.type });
    if (!result.valid) {
      setAvatarError(result.error ?? "Invalid file. Please check size and type.");
      setAvatarFile(null);
      setAvatarPreview(null);
    } else {
      setAvatarError(null);
      setAvatarFile(file);
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
  }

  const onSubmit = async (data: ProfileEditFormData) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      if (avatarFile) {
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => (prev >= 95 ? 95 : prev + 10));
        }, 100);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        clearInterval(progressInterval);
      }

      await new Promise((resolve) => setTimeout(resolve, 800));

      const update: UserProfileUpdate = {
        username: data.username,
        bio: data.bio,
        avatar: avatarFile ? (avatarPreview ?? undefined) : undefined,
        socialLinks: {
          twitter: data.twitter,
          discord: data.discord,
          twitch: data.twitch,
          github: data.github,
        },
      };

      analytics.trackSubmit({ success: true });

      // Reset dirty state after save
      form.reset(data);
      setAvatarFile(null);
      setUploadProgress(100);
    } catch (err) {
      analytics.trackSubmit({ success: false });
      form.setError("root", {
        message: "Failed to save profile. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  function handleCancel() {
    if (isDirty) {
      setShowUnsavedWarning(true);
    } else {
      router.back();
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit Profile</h1>
        {isDirty && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
          {/* Avatar */}
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
                accept={{ "image/jpeg": [], "image/png": [], "image/webp": [] }}
                maxSize={5 * 1024 * 1024}
                disabled={form.formState.isSubmitting}
              />
              {avatarError && (
                <p className="text-sm text-destructive flex items-center gap-1 mt-2">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {avatarError}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Username */}
          <Card>
            <CardHeader>
              <CardTitle>Username</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter your username"
                        error={!!form.formState.errors.username}
                      />
                    </FormControl>
                    <div className="flex justify-between items-center">
                      <FormDescription>
                        {watchedUsername.length} / 20 characters
                      </FormDescription>
                      {usernameStatus === "available" &&
                        !form.formState.errors.username && (
                          <span className="text-xs text-success flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Available
                          </span>
                        )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Bio */}
          <Card>
            <CardHeader>
              <CardTitle>Bio</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <textarea
                        {...field}
                        rows={4}
                        className={cn(
                          "w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring",
                          form.formState.errors.bio && "border-destructive"
                        )}
                        placeholder="Tell others about yourself..."
                      />
                    </FormControl>
                    <p
                      aria-live="polite"
                      className={cn(
                        "text-xs text-right",
                        watchedBio.length > 280
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {watchedBio.length} / 280
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Social Links */}
          <Card>
            <CardHeader>
              <CardTitle>Social Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="twitter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Twitter className="h-4 w-4" /> Twitter
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://twitter.com/username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="discord"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <span className="h-4 w-4 bg-indigo-500 rounded-full inline-block" />
                      Discord
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Username#0000" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="twitch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Twitch className="h-4 w-4" /> Twitch
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://twitch.tv/username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="github"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Github className="h-4 w-4" /> GitHub
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://github.com/username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Customization */}
          <Card>
            <CardHeader>
              <CardTitle>Profile Customization</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomizationOptions
                current={customization}
                onChange={setCustomization}
              />
            </CardContent>
          </Card>

          {/* Root error */}
          {form.formState.errors.root && (
            <div
              role="alert"
              className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive rounded-md text-destructive"
            >
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              <p className="text-sm">{form.formState.errors.root.message}</p>
            </div>
          )}

          {/* Success */}
          {form.formState.isSubmitSuccessful && !form.formState.isDirty && (
            <div
              role="status"
              className="flex items-center gap-2 p-4 bg-success/90 text-white rounded-md"
            >
              <CheckCircle className="h-5 w-5" aria-hidden="true" />
              <p className="text-sm font-medium">Profile saved successfully!</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={
                form.formState.isSubmitting ||
                usernameStatus === "checking" ||
                usernameStatus === "unavailable"
              }
              className="flex-1"
            >
              {form.formState.isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Form>

      {/* Unsaved Changes Warning */}
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
                  onClick={() => {
                    setShowUnsavedWarning(false);
                    router.back();
                  }}
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
