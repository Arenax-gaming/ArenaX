"use client";

import React, { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Sparkles, ExternalLink } from "lucide-react";
import type { Tournament, TournamentSponsor } from "@/types/tournament";

export function getActiveSponsors(tournament?: Tournament | null): TournamentSponsor[] {
  if (!tournament) return [];
  if (tournament.sponsors && tournament.sponsors.length > 0) {
    return tournament.sponsors.filter((s) => s.isActive !== false);
  }
  if (tournament.sponsor && tournament.sponsor.isActive !== false) {
    return [tournament.sponsor];
  }
  return [];
}

export function getPrimarySponsor(tournament?: Tournament | null): TournamentSponsor | null {
  const active = getActiveSponsors(tournament);
  return active.length > 0 ? active[0] : null;
}

interface SponsorBadgeProps {
  tournament?: Tournament | null;
  sponsor?: TournamentSponsor | null;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Renders a sponsor badge on tournament cards or headers.
 * Degrades gracefully (returns null) for non-sponsored tournaments.
 */
export function TournamentSponsorBadge({
  tournament,
  sponsor: propSponsor,
  size = "sm",
  className = "",
}: SponsorBadgeProps) {
  const sponsor = propSponsor || getPrimarySponsor(tournament);
  if (!sponsor) return null;

  const color = sponsor.brandColor || sponsor.color || "#3b82f6";
  const logo = sponsor.logoUrl || sponsor.logo_url;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-all ${
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"
      } ${className}`}
      style={{
        backgroundColor: `${color}15`,
        borderColor: `${color}40`,
        borderWidth: "1px",
        color: color,
      }}
      title={`Sponsored by ${sponsor.name}`}
      data-testid="tournament-sponsor-badge"
    >
      {logo ? (
        <img
          src={logo}
          alt={sponsor.name}
          className={`${size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} rounded object-contain`}
          onError={(e) => {
            // fallback if logo fails to load
            (e.target as HTMLElement).style.display = "none";
          }}
        />
      ) : (
        <Sparkles className={`${size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
      )}
      <span className="truncate max-w-[120px]">
        {size === "sm" ? sponsor.name : `Sponsored by ${sponsor.name}`}
      </span>
    </span>
  );
}

interface TournamentSponsorRowProps {
  tournament?: Tournament | null;
  sponsors?: TournamentSponsor[];
  className?: string;
}

/**
 * Displays multiple sponsors in a stacked or carousel row with brand logos,
 * names, and colors. Degrades gracefully if no sponsors are present.
 */
export function TournamentSponsorRow({
  tournament,
  sponsors: propSponsors,
  className = "",
}: TournamentSponsorRowProps) {
  const sponsors = propSponsors || getActiveSponsors(tournament);
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!sponsors || sponsors.length === 0) return null;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : sponsors.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < sponsors.length - 1 ? prev + 1 : 0));
  };

  // If only 1 or 2 sponsors, show as a clean stacked/flex row
  // If 3 or more, provide carousel controls + row preview
  return (
    <div
      className={`rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm ${className}`}
      data-testid="tournament-sponsors-section"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Official Tournament {sponsors.length > 1 ? "Sponsors" : "Sponsor"}
          </h4>
        </div>
        {sponsors.length > 2 && (
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              aria-label="Previous sponsor"
              className="p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground px-1">
              {currentIndex + 1} / {sponsors.length}
            </span>
            <button
              onClick={handleNext}
              aria-label="Next sponsor"
              className="p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Row list / carousel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {sponsors.map((sponsor, idx) => {
          const color = sponsor.brandColor || sponsor.color || "#3b82f6";
          const logo = sponsor.logoUrl || sponsor.logo_url;
          const isFeatured = idx === currentIndex;

          return (
            <div
              key={sponsor.id || sponsor.name + idx}
              className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
                isFeatured
                  ? "ring-1 ring-offset-1 shadow-sm"
                  : "opacity-90 hover:opacity-100"
              }`}
              style={{
                borderColor: `${color}50`,
                backgroundColor: `${color}08`,
                ringColor: color,
              }}
            >
              {logo ? (
                <div
                  className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden flex items-center justify-center p-1 bg-background/80 border"
                  style={{ borderColor: `${color}30` }}
                >
                  <img
                    src={logo}
                    alt={sponsor.name}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div
                  className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center font-bold text-white text-sm"
                  style={{ backgroundColor: color }}
                >
                  {sponsor.name.slice(0, 2).toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-foreground truncate">
                    {sponsor.name}
                  </span>
                  {sponsor.websiteUrl && (
                    <a
                      href={sponsor.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate capitalize">
                  {sponsor.tier ? `${sponsor.tier} Partner` : "Official Partner"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
