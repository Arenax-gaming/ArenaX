"use client";

/**
 * Avatar upload (Issue #1396): pick a JPG/PNG up to 2 MB → square crop
 * preview → upload → CDN URL with a cache-busting version, plus toasts.
 */

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useNotifications } from "@/contexts/NotificationContext";
import { AvatarCropModal } from "./AvatarCropModal";
import {
  AVATAR_ACCEPTED_TYPES,
  AVATAR_ERROR_MESSAGES,
  uploadAvatar,
  validateAvatarFile,
  type AvatarMimeType,
} from "@/api/profileSettings";

interface AvatarUploadProps {
  /** Current avatar URL (already CDN + versioned). */
  avatarUrl?: string | null;
  username?: string;
  onUploaded?: (avatarUrl: string) => void;
}

export function AvatarUpload({ avatarUrl, username, onUploaded }: AvatarUploadProps) {
  const { addToast } = useNotifications();
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentUrl, setCurrentUrl] = useState(avatarUrl ?? null);
  const [selection, setSelection] = useState<{ url: string; type: AvatarMimeType } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => setCurrentUrl(avatarUrl ?? null), [avatarUrl]);

  // Release the object URL whenever the selection is replaced or cleared.
  useEffect(() => {
    if (!selection) return;
    return () => URL.revokeObjectURL(selection.url);
  }, [selection]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file) return;

    const error = await validateAvatarFile(file);
    if (error) {
      const message = AVATAR_ERROR_MESSAGES[error];
      setValidationError(message);
      addToast({ type: "error", title: "Can't use that image", message });
      return;
    }
    setValidationError(null);
    setSelection({ url: URL.createObjectURL(file), type: file.type as AvatarMimeType });
  };

  const handleCropped = async (blob: Blob) => {
    setIsUploading(true);
    try {
      const { avatarUrl: url } = await uploadAvatar(blob);
      setCurrentUrl(url);
      onUploaded?.(url);
      setSelection(null);
      addToast({ type: "success", title: "Avatar updated", message: "Your new avatar is live." });
    } catch (err) {
      addToast({
        type: "error",
        title: "Avatar upload failed",
        message: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const initial = (username ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border bg-muted">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL with cache-busting query
          <img
            src={currentUrl}
            alt={username ? `${username}'s avatar` : "Your avatar"}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground"
            aria-hidden="true"
          >
            {initial}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <input
          ref={inputRef}
          id="avatar-file"
          type="file"
          accept={AVATAR_ACCEPTED_TYPES.join(",")}
          className="sr-only"
          onChange={handleFileChange}
          aria-describedby="avatar-hint avatar-error"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Change avatar
        </Button>
        <p id="avatar-hint" className="text-xs text-muted-foreground">
          JPG or PNG, up to 2 MB. You&apos;ll crop it to a square before saving.
        </p>
        <p id="avatar-error" role="alert" className="text-xs text-destructive-text">
          {validationError}
        </p>
      </div>

      <AvatarCropModal
        isOpen={selection !== null}
        imageUrl={selection?.url ?? null}
        mimeType={selection?.type ?? "image/png"}
        isSaving={isUploading}
        onCancel={() => setSelection(null)}
        onCropped={handleCropped}
      />
    </div>
  );
}

export default AvatarUpload;
