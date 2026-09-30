"use client";

import { useEffect } from "react";

interface MatchTabStatusOptions {
  /** Whether the match is currently live (pending / in progress). */
  active: boolean;
  /** Whether the current user needs to act. */
  isYourTurn?: boolean;
  /** Unread notification count rendered as a favicon badge. */
  notificationCount?: number;
  /** Label appended to the tab title while the match is active. */
  label?: string;
}

const ACTIVE_COLOR = "#2563eb";
const TURN_COLOR = "#16a34a";

function getFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function drawFavicon(color: string, count: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("X", 16, 17);

  if (count > 0) {
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(24, 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(count > 9 ? "9+" : String(count), 24, 9);
  }
  return canvas.toDataURL("image/png");
}

/**
 * Reflects live match state in the browser tab: title prefix ("Your Turn" /
 * notification count) and a dynamic favicon with a badge. Restores the
 * original title and favicon once the match is no longer active or on unmount.
 */
export function useMatchTabStatus({
  active,
  isYourTurn = false,
  notificationCount = 0,
  label = "Match in progress",
}: MatchTabStatusOptions): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const originalTitle = document.title;
    const link = getFaviconLink();
    const originalHref = link.getAttribute("href");

    const prefix = [
      notificationCount > 0 ? `(${notificationCount})` : "",
      isYourTurn ? "Your Turn!" : label,
    ]
      .filter(Boolean)
      .join(" ");
    document.title = `${prefix} · ${originalTitle}`;

    const icon = drawFavicon(isYourTurn ? TURN_COLOR : ACTIVE_COLOR, notificationCount);
    if (icon) link.href = icon;

    return () => {
      document.title = originalTitle;
      if (originalHref) link.setAttribute("href", originalHref);
      else link.removeAttribute("href");
    };
  }, [active, isYourTurn, notificationCount, label]);
}
