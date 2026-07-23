"use client";

import React, { useCallback } from "react";
import { a11yAnalytics } from "@/lib/accessibility";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkipLinkProps {
  /** The `id` of the element to skip to. Must exist on the page. */
  targetId: string;
  /** Link text visible on focus. Defaults to "Skip to main content". */
  label?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * `SkipLink` renders a visually-hidden-until-focused link that jumps keyboard
 * users past repetitive navigation to the main content area.
 *
 * Enhancements over the old version:
 * - Tracks usage in accessibility analytics
 * - Programmatically sets focus on the target element so all browsers honour
 *   the skip (not just scroll)
 * - Accessible label is customisable
 *
 * Usage in `AppLayout`:
 * ```tsx
 * <SkipLink targetId="main-content" />
 * <header>…</header>
 * <main id="main-content" tabIndex={-1}>…</main>
 * ```
 */
export const SkipLink: React.FC<SkipLinkProps> = ({
  targetId,
  label = "Skip to main content",
}) => {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      const target = document.getElementById(targetId);
      if (target) {
        // Ensure the element is programmatically focusable
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
        }
        target.focus();
        // Scroll into view for sighted keyboard users
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      a11yAnalytics.track("skip_link_used", targetId);
    },
    [targetId],
  );

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={[
        // Hidden off-screen until focused
        "fixed top-4 left-4 z-[9999]",
        "-translate-y-[200%] focus:translate-y-0",
        // Visible style when focused
        "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg",
        "outline-none ring-2 ring-primary ring-offset-2 ring-offset-background",
        "transition-transform duration-150",
      ].join(" ")}
    >
      {label}
    </a>
  );
};
