"use client";

/**
 * TournamentShareButton (#897)
 *
 * Renders a share trigger (button or icon-only variant) that opens a modal
 * with options to:
 *   1. Share to Twitter / X via tweet intent popup
 *   2. Copy a pre-formatted Discord message to clipboard
 *   3. Copy the bare results link to clipboard
 *   4. (Mobile / PWA) trigger the native Web Share sheet
 *
 * Analytics: every share action fires a "tournament_win_shared" event via
 * the useAnalytics hook (wired inside useTournamentShare).
 *
 * Usage:
 *   <TournamentShareButton tournament={tournament} winner={champion.winner} />
 *   <TournamentShareButton tournament={tournament} winner={champion.winner} variant="icon" />
 */

import { useState } from "react";
import {
  Share2,
  Copy,
  Check,
  Link as LinkIcon,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { useTournamentShare } from "@/hooks/useTournamentShare";
import type { Tournament } from "@/types/tournament";
import type { BracketPlayer } from "@/types/bracket";

// ── Twitter / X brand icon (inline SVG — no extra dep needed) ────────────────
function TwitterXIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.258 5.63 5.906-5.63Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// ── Discord brand icon (inline SVG) ──────────────────────────────────────────
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export interface TournamentShareButtonProps {
  tournament: Tournament;
  /** The confirmed champion. When omitted the share message uses a generic winner label. */
  winner?: BracketPlayer | null;
  /**
   * "button"  — renders a labelled button (default, for results page CTA)
   * "icon"    — renders an icon-only button (for compact contexts like TournamentHeader)
   */
  variant?: "button" | "icon";
  className?: string;
}

export function TournamentShareButton({
  tournament,
  winner,
  variant = "button",
  className,
}: TournamentShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    shareToTwitter,
    copyDiscordMessage,
    copyLink,
    shareNative,
    hasCopied,
    shareUrl,
    shareMessage,
    supportsNativeShare,
  } = useTournamentShare(tournament, winner);

  // ── Clipboard button label helpers ────────────────────────────────────────
  // We track which action was last triggered so we can show the right
  // "Copied!" label on the correct button without extra state.
  const [lastAction, setLastAction] = useState<"discord" | "link" | null>(null);

  const handleCopyDiscord = async () => {
    const ok = await copyDiscordMessage();
    if (ok) setLastAction("discord");
  };

  const handleCopyLink = async () => {
    const ok = await copyLink();
    if (ok) setLastAction("link");
  };

  // Reset lastAction when hasCopied resets (the hook clears it after 2.5 s)
  // We mirror by resetting locally when hasCopied flips back to false.
  // This is handled implicitly: once hasCopied is false, neither button shows
  // the success state regardless of lastAction.

  const discordCopied = hasCopied && lastAction === "discord";
  const linkCopied = hasCopied && lastAction === "link";

  // ── Trigger button ────────────────────────────────────────────────────────
  const triggerButton =
    variant === "icon" ? (
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsOpen(true)}
        className={cn("shrink-0", className)}
        aria-label="Share tournament win"
        title="Share this win"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    ) : (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={cn("gap-2", className)}
        aria-label="Share tournament win"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Share Win
      </Button>
    );

  return (
    <>
      {triggerButton}

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="🏆 Share This Win"
        size="sm"
      >
        <div className="space-y-5">
          {/* ── Share message preview ─────────────────────────────────── */}
          <div
            className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm italic text-muted-foreground"
            aria-label="Share message preview"
          >
            {shareMessage}
          </div>

          {/* ── Platform share actions ────────────────────────────────── */}
          <div className="space-y-2" role="group" aria-label="Share options">

            {/* Twitter / X */}
            <Button
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={() => {
                shareToTwitter();
                setIsOpen(false);
              }}
            >
              <TwitterXIcon className="h-4 w-4 shrink-0" />
              <span>Share on Twitter / X</span>
              <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>

            {/* Discord — copy formatted message */}
            <Button
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={handleCopyDiscord}
            >
              <DiscordIcon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">
                {discordCopied ? "Copied for Discord!" : "Copy message for Discord"}
              </span>
              {discordCopied ? (
                <Check className="ml-auto h-4 w-4 text-success shrink-0" aria-hidden="true" />
              ) : (
                <Copy className="ml-auto h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              )}
            </Button>

            {/* Copy results link */}
            <Button
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={handleCopyLink}
            >
              <LinkIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left truncate text-sm font-normal text-muted-foreground">
                {linkCopied ? "Link copied!" : shareUrl}
              </span>
              {linkCopied ? (
                <Check className="ml-auto h-4 w-4 text-success shrink-0" aria-hidden="true" />
              ) : (
                <Copy className="ml-auto h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              )}
            </Button>

            {/* Native share — only shown when the API is available (mobile / PWA) */}
            {supportsNativeShare && (
              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={async () => {
                  await shareNative();
                  setIsOpen(false);
                }}
              >
                <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>More options…</span>
              </Button>
            )}
          </div>

          {/* ── Powered-by footer ────────────────────────────────────── */}
          <p className="text-center text-xs text-muted-foreground">
            Sharing on ArenaX helps grow the community 🎮
          </p>
        </div>
      </Modal>
    </>
  );
}
