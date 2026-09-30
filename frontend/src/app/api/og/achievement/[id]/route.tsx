import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { MOCK_ACHIEVEMENTS, type AchievementRarity } from "@/data/achievements";

export const runtime = "edge";

const RARITY_STYLE: Record<AchievementRarity, { label: string; accent: string; glow: string }> = {
  common: { label: "Common", accent: "#9ca3af", glow: "rgba(156,163,175,0.35)" },
  rare: { label: "Rare", accent: "#38bdf8", glow: "rgba(56,189,248,0.35)" },
  epic: { label: "Epic", accent: "#a855f7", glow: "rgba(168,85,247,0.4)" },
  legendary: { label: "Legendary", accent: "#f59e0b", glow: "rgba(245,158,11,0.45)" },
};

/**
 * GET /api/og/achievement/:id?player=Name (#1097)
 *
 * Dynamic 1200x630 share-card PNG for an achievement — player name,
 * achievement icon, and rarity, rendered at the edge with `next/og`.
 * `?player=` is optional (a bare share of the achievement itself, not a
 * specific player's unlock, omits it).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const achievement = MOCK_ACHIEVEMENTS.find((a) => a.id === params.id);
  const playerName = request.nextUrl.searchParams.get("player");

  if (!achievement) {
    return new Response("Achievement not found", { status: 404 });
  }

  const rarity = RARITY_STYLE[achievement.rarity];

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "220px",
            height: "220px",
            borderRadius: "9999px",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "120px",
            background: rarity.glow,
            border: `4px solid ${rarity.accent}`,
            marginBottom: "32px",
          }}
        >
          {achievement.icon}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "20px",
            letterSpacing: "6px",
            textTransform: "uppercase",
            color: rarity.accent,
            marginBottom: "12px",
          }}
        >
          {rarity.label} Achievement
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "56px",
            fontWeight: 700,
            color: "#ffffff",
            marginBottom: playerName ? "16px" : "0px",
          }}
        >
          {achievement.title}
        </div>
        {playerName && (
          <div style={{ display: "flex", fontSize: "28px", color: "#cbd5e1" }}>
            Unlocked by {playerName}
          </div>
        )}
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: "36px",
            fontSize: "24px",
            fontWeight: 600,
            color: "#64748b",
          }}
        >
          ArenaX
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );

  // Cached at the edge CDN for a day (#1097) — achievement metadata rarely
  // changes, so repeat unfurls (Discord/Twitter/WhatsApp all re-fetch) hit
  // cache instead of re-rendering.
  image.headers.set("Cache-Control", "public, max-age=86400, immutable");
  return image;
}
