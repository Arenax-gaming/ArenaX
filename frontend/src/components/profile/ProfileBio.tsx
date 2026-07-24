"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User } from "@/types/user";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Edit2, Twitter, Twitch, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_BIO_LENGTH,
  profileBioSchema,
  type ProfileBioFormData,
} from "@/lib/validations/profile";

interface ProfileBioProps {
  user: User;
  /** Controls edit mode externally. If omitted the component manages its own state. */
  isEditing?: boolean;
  /** Called when the component requests edit mode to change. Only needed for controlled usage. */
  onEditToggle?: (editing: boolean) => void;
  onSave: (updatedUser: Partial<User>) => void;
}

export function ProfileBio({ user, isEditing: isEditingProp, onEditToggle, onSave }: ProfileBioProps) {
  const [internalEditing, setInternalEditing] = React.useState(false);
  const isEditing = isEditingProp !== undefined ? isEditingProp : internalEditing;
  const setEditing = (v: boolean) => {
    if (onEditToggle) onEditToggle(v);
    else setInternalEditing(v);
  };
  const form = useForm<ProfileBioFormData & {
    twitter: string;
    discord: string;
    twitch: string;
  }>({
    resolver: zodResolver(profileBioSchema),
    defaultValues: {
      bio: user.bio ?? "",
      twitter: user.socialLinks?.twitter ?? "",
      discord: user.socialLinks?.discord ?? "",
      twitch: user.socialLinks?.twitch ?? "",
    },
  });

  const bioValue = form.watch("bio") ?? "";
  const bioLength = bioValue.length;
  const bioNearLimit = bioLength >= Math.floor(MAX_BIO_LENGTH * 0.9);

  const handleSave = form.handleSubmit((data) => {
    onSave({
      bio: data.bio,
      socialLinks: {
        ...user.socialLinks,
        twitter: data.twitter,
        discord: data.discord,
        twitch: data.twitch,
      },
    });
    setEditing(false);
  });

  const handleCancel = () => {
    form.reset({
      bio: user.bio ?? "",
      twitter: user.socialLinks?.twitter ?? "",
      discord: user.socialLinks?.discord ?? "",
      twitch: user.socialLinks?.twitch ?? "",
    });
    setEditing(false);
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">About Me</CardTitle>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Edit2 className="h-4 w-4 mr-2" />
            Edit Profile
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {isEditing ? (
          <Form {...form}>
            <form id="profile-bio-form" onSubmit={handleSave} className="space-y-4">
              {/* Bio */}
              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bio</FormLabel>
                    <FormControl>
                      <textarea
                        {...field}
                        aria-invalid={!!form.formState.errors.bio}
                        className={cn(
                          "flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                          form.formState.errors.bio && "border-destructive"
                        )}
                        placeholder="Tell us about yourself..."
                      />
                    </FormControl>
                    <p
                      aria-live="polite"
                      className={cn(
                        "text-xs text-right",
                        bioNearLimit
                          ? "text-destructive font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {bioLength} / {MAX_BIO_LENGTH}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Social links */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="twitter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Twitter className="h-4 w-4" /> Twitter URL
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://twitter.com/..."
                        />
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
                        <Twitch className="h-4 w-4" /> Twitch URL
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://twitch.tv/..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        ) : (
          <>
            <p className="text-sm text-foreground leading-relaxed italic">
              {'"'}{user.bio || "No bio set yet."}{'"'}
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
          <Button variant="ghost" size="sm" type="button" onClick={handleCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            form="profile-bio-form"
            disabled={form.formState.isSubmitting}
          >
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
