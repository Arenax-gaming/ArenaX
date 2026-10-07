import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { mockTournaments } from "@/data/mockTournaments";

export const runtime = "edge";

const MEDAL = ["🥇", "🥈", "🥉"] as const;

/**
 * GET /api/og/tournament/:id/result?first=X&second=Y&third=Z (#1097)
 *
 * Dynamic 1200x630 share-card PNG for a tournament's final standings — top
 * 3 players and the prize pool. Placements come in as query params (set by
 * the results page's `generateMetadata`, which is what actually knows the
 * bracket's standings) rather than being recomputed here, so this route
 * stays a pure, easily-cached render of whatever it's given.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const tournament = mockTournaments.find((t) => t.id === params.id);
  if (!tournament) {
    return new Response("Tournament not found", { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const placements = [
    searchParams.get("first"),
    searchParams.get("second"),
    searchParams.get("third"),
  ].filter((name): name is string => Boolean(name));

  const prize = tournament.prizePool.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

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
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: "22px", letterSpacing: "6px", textTransform: "uppercase", color: "#a5b4fc", marginBottom: "8px" }}>
          Tournament Results
        </div>
        <div style={{ display: "flex", fontSize: "52px", fontWeight: 700, color: "#ffffff", marginBottom: "36px", textAlign: "center" }}>
          {tournament.name}
        </div>

        <div style={{ display: "flex", gap: "48px", marginBottom: "36px" }}>
          {placements.length > 0 ? (
            placements.map((name, i) => (
              <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", fontSize: "64px" }}>{MEDAL[i]}</div>
                <div style={{ display: "flex", fontSize: "26px", color: "#e0e7ff", marginTop: "8px" }}>{name}</div>
              </div>
            ))
          ) : (
            <div style={{ display: "flex", fontSize: "28px", color: "#c7d2fe" }}>
              Final standings coming soon
            </div>
          )}
        </div>

        <div style={{ display: "flex", fontSize: "32px", fontWeight: 600, color: "#facc15" }}>
          Prize Pool: {prize}
        </div>

        <div style={{ display: "flex", position: "absolute", bottom: "36px", fontSize: "24px", fontWeight: 600, color: "#818cf8" }}>
          ArenaX
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );

  image.headers.set("Cache-Control", "public, max-age=86400, immutable");
  return image;
}
