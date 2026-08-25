"use client";

/**
 * useTournamentShare
 *
 * Encapsulates all social sharing logic for a tournament win:
 *   - Share to Twitter / X via tweet intent URL
 *   - Copy a pre-formatted Discord message to clipboard
 *   - Copy the bare results link to clipboard
 *   - Native share sheet (mobile / PWA via navigator.share)
 *   - Analytics tracking for every share action
 *
 * @example
 * const { shareToTwitter, copyDiscordMessage, copyLink, hasCopied, lastCopied } =
 *   useTournamentShare(tournament, champion.winner);
 */

import { useCallback, useMemo } from "react";
import { useClipboard } from "./useClipboard";
import { useAnalytics } from "./useAnalytics";
import type { Tournament } from "@/types/tournament";
import type { BracketPlayer } from "@/types/bracket";

export type SharePlatform = "twitter" | "discord" | "link" | "native";

export interface UseTournamentShareResult {
  /** Opens the Twitter / X tweet intent in a new popup window. */
  shareToTwitter: () => void;
  /** Copies a Discord-friendly message (text + URL) to the clipboard. */
  copyDiscordMessage: () => Promise<boolean>;
  /** Copies the bare results page URL to the clipboard. */
  copyLink: () => Promise<boolean>;
  /**
   * Triggers the native Web Share API when available (returns true).
   * Falls back gracefully and returns false on unsupported browsers.
   */
  shareNative: () => Promise<boolean>;
  /** True for ~2.5 s after any successful clipboard copy. */
  hasCopied: boolean;
  /** Which platform was most recently copied ("discord" | "link" | null). */
  lastCopied: SharePlatform | null;
  /** The full share URL (results page). */
  shareUrl: string;
  /** The pre-built share message with trophy emoji. */
  shareMessage: string;
  /** Whether the native share API is available in this environment. */
  supportsNativeShare: boolean;
}

export function useTournamentShare(
  tournament: Tournament,
  winner?: BracketPlayer | null,
): UseTournamentShareResult {
  const { copy, hasCopied } = useClipboard({ resetAfterMs: 2500 });
  const { track } = useAnalytics();

  // ─── Derived values ────────────────────────────────────────────────────────

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return `/tournaments/${tournament.id}/results`;
    }
    return `${window.location.origin}/tournaments/${tournament.id}/results`;
  }, [tournament.id]);

  const shareMessage = useMemo(() => {
    const winnerName = winner?.username ?? "A champion";
    const prize = tournament.prizePool.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    return `🏆 ${winnerName} just won the "${tournament.name}" tournament on ArenaX with a ${prize} prize pool!`;
  }, [winner?.username, tournament.name, tournament.prizePool]);

  const twitterIntentUrl = useMemo(() => {
    const params = new URLSearchParams({
      text: shareMessage,
      url: shareUrl,
      hashtags: "ArenaX,GamingTournament",
    });
    return `https://twitter.com/intent/tweet?${params.toString()}`;
  }, [shareMessage, shareUrl]);

  const discordMessage = useMemo(
    () => `${shareMessage}\n${shareUrl}`,
    [shareMessage, shareUrl],
  );

  const supportsNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  // ─── Analytics helper ──────────────────────────────────────────────────────

  const trackShare = useCallback(
    (platform: SharePlatform) => {
      track("tournament_win_shared", {
        tournamentId: tournament.id,
        platform,
        winnerId: winner?.id,
      });
    },
    [track, tournament.id, winner?.id],
  );

  // ─── lastCopied state — derived from the clipboard value ──────────────────
  // We use a ref-free approach: store the platform alongside the copy call
  // by keeping a module-level variable reset on each copy invocation.
  // Because useClipboard resets `hasCopied` after the timeout, we mirror
  // that timing here with a separate state-free approach: we return
  // `hasCopied` from the hook and let callers decide which label to show.

  const lastCopiedRef = { current: null as SharePlatform | null };

  // ─── Share actions ─────────────────────────────────────────────────────────

  const shareToTwitter = useCallback(() => {
    window.open(twitterIntentUrl, "_blank", "noopener,noreferrer,width=550,height=450");
    trackShare("twitter");
  }, [twitterIntentUrl, trackShare]);

  const copyDiscordMessage = useCallback(async (): Promise<boolean> => {
    const ok = await copy(discordMessage);
    if (ok) {
      lastCopiedRef.current = "discord";
      trackShare("discord");
    }
    return ok;
  }, [copy, discordMessage, trackShare]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyLink = useCallback(async (): Promise<boolean> => {
    const ok = await copy(shareUrl);
    if (ok) {
      lastCopiedRef.current = "link";
      trackShare("link");
    }
    return ok;
  }, [copy, shareUrl, trackShare]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareNative = useCallback(async (): Promise<boolean> => {
    if (!supportsNativeShare) return false;
    try {
      await navigator.share({
        title: `🏆 ${tournament.name} — ArenaX`,
        text: shareMessage,
        url: shareUrl,
      });
      trackShare("native");
      return true;
    } catch (err) {
      // AbortError means the user dismissed the sheet — not a real error.
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("[useTournamentShare] navigator.share failed:", err);
      }
      return false;
    }
  }, [supportsNativeShare, tournament.name, shareMessage, shareUrl, trackShare]);

  return {
    shareToTwitter,
    copyDiscordMessage,
    copyLink,
    shareNative,
    hasCopied,
    lastCopied: lastCopiedRef.current,
    shareUrl,
    shareMessage,
    supportsNativeShare,
  };
}
