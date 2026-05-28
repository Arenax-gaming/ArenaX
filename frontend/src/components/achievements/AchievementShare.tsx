/**
 * Achievement share button (#296).
 *
 * Lets a player share an unlocked achievement via the platform Web
 * Share API where available, falling back to clipboard copy when not.
 * Generates a short, link-shaped message so social previews carry the
 * achievement name + a deep-link back to the achievement detail page.
 *
 * Designed to be dropped beside `<AchievementCard />` or inside
 * `<AchievementDetails />` — small footprint, accessible label, no
 * external dependencies beyond `navigator.share` / `navigator.clipboard`.
 */

"use client";

import React, { useCallback, useState } from "react";
import { Share2, Check } from "lucide-react";

export interface AchievementShareProps {
    /** Stable id for the deep-link back to the achievement page. */
    achievementId: string;
    /** Human-readable title (used in the share text). */
    title: string;
    /**
     * Optional flavor description that follows the title in the share
     * payload. Truncated to ~140 chars to keep social embeds tidy.
     */
    description?: string;
    /**
     * Override the deep-link URL. Defaults to
     * `${window.location.origin}/achievements/${achievementId}` so the
     * component works without wiring at the call site.
     */
    shareUrl?: string;
    /** Disable the trigger (e.g. while the achievement is locked). */
    disabled?: boolean;
    className?: string;
}

export interface ShareMessage {
    title: string;
    text: string;
    url: string;
}

/**
 * Pure helper: build the message the share API / clipboard will get.
 * Exported so tests and other call sites can verify / reuse the
 * formatting independently of the React component.
 */
export const buildAchievementShareMessage = (
    achievementId: string,
    title: string,
    description: string | undefined,
    overrideUrl: string | undefined
): ShareMessage => {
    const trimmedDesc = description ? description.trim() : "";
    const truncatedDesc =
        trimmedDesc.length > 140
            ? trimmedDesc.slice(0, 139).trimEnd() + "…"
            : trimmedDesc;
    const url =
        overrideUrl ??
        (typeof window !== "undefined"
            ? `${window.location.origin}/achievements/${achievementId}`
            : `/achievements/${achievementId}`);
    const text = truncatedDesc
        ? `I just unlocked "${title}" on ArenaX — ${truncatedDesc}`
        : `I just unlocked "${title}" on ArenaX!`;
    return {
        title: `ArenaX Achievement: ${title}`,
        text,
        url,
    };
};

export const AchievementShare: React.FC<AchievementShareProps> = ({
    achievementId,
    title,
    description,
    shareUrl,
    disabled = false,
    className,
}) => {
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleShare = useCallback(async () => {
        const message = buildAchievementShareMessage(
            achievementId,
            title,
            description,
            shareUrl
        );

        // Prefer the native share sheet — it's the platform-native UX
        // (iOS share sheet, Android intent picker, etc.). Falls back to
        // clipboard copy whenever the API is missing or the user
        // cancels with anything other than a real error.
        if (
            typeof navigator !== "undefined" &&
            typeof navigator.share === "function"
        ) {
            try {
                await navigator.share(message);
                return;
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") {
                    return; // user dismissed — not an error.
                }
                // fall through to clipboard
            }
        }

        const payload = `${message.text}\n${message.url}`;
        if (
            typeof navigator !== "undefined" &&
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
        ) {
            try {
                await navigator.clipboard.writeText(payload);
                setCopied(true);
                setError(null);
                window.setTimeout(() => setCopied(false), 1800);
                return;
            } catch {
                setError("Couldn't copy — share manually");
                return;
            }
        }
        setError("Sharing not supported in this browser");
    }, [achievementId, title, description, shareUrl]);

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={handleShare}
            aria-label={`Share achievement: ${title}`}
            className={
                "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/85 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:opacity-50" +
                (className ? ` ${className}` : "")
            }
        >
            {copied ? (
                <>
                    <Check className="size-3 text-emerald-300" aria-hidden="true" />
                    Copied
                </>
            ) : (
                <>
                    <Share2 className="size-3 text-amber-300" aria-hidden="true" />
                    Share
                </>
            )}
            {error && (
                <span className="sr-only" role="alert">
                    {error}
                </span>
            )}
        </button>
    );
};

export default AchievementShare;
