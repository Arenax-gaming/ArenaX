"use client";

import Image from "next/image";
import { useEffect, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Sparkles } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import type { TournamentSponsor } from "@/types/tournament";

interface SponsorCarouselProps {
  sponsors: TournamentSponsor[];
  tournamentId?: string;
  intervalMs?: number;
}

export function SponsorCarousel({
  sponsors,
  tournamentId,
  intervalMs = 5000,
}: SponsorCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const { track } = useAnalytics();

  useEffect(() => {
    if (paused || sponsors.length < 2 || intervalMs <= 0) return;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % sponsors.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, paused, sponsors.length]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, sponsors.length - 1)));
  }, [sponsors.length]);

  if (sponsors.length === 0) return null;

  const activeSponsor = sponsors[activeIndex];
  const logo = activeSponsor.logoUrl || activeSponsor.logo_url;
  const url = activeSponsor.websiteUrl || activeSponsor.url;

  const showPrevious = () => {
    setActiveIndex((index) => (index - 1 + sponsors.length) % sponsors.length);
  };
  const showNext = () => {
    setActiveIndex((index) => (index + 1) % sponsors.length);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showNext();
    }
  };
  const trackClick = () => {
    track("sponsor_clicked", {
      sponsorId: activeSponsor.id,
      sponsorName: activeSponsor.name,
      tournamentId,
      destination: url,
    });
  };

  return (
    <section
      className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm"
      aria-label="Tournament sponsors"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Official sponsors
          </h2>
        </div>
        {sponsors.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {activeIndex + 1} / {sponsors.length}
            </span>
            <button type="button" onClick={showPrevious} aria-label="Previous sponsor" className="rounded-full p-1 hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={showNext} aria-label="Next sponsor" className="rounded-full p-1 hover:bg-muted">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        className="flex min-h-24 items-center justify-center rounded-xl bg-muted/40 px-4 py-3"
        role="group"
        aria-roledescription="slide"
        aria-label={`${activeIndex + 1} of ${sponsors.length}: ${activeSponsor.name}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        data-testid="sponsor-slide"
      >
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={trackClick}
            className="flex w-full items-center justify-center gap-5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
            aria-label={`Visit ${activeSponsor.name}, sponsor ${activeIndex + 1} of ${sponsors.length}`}
          >
            {logo ? (
              <Image src={logo} alt={`${activeSponsor.name} logo`} width={160} height={72} sizes="160px" unoptimized className="max-h-[72px] w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-background text-xl font-bold">{activeSponsor.name.slice(0, 2).toUpperCase()}</span>
            )}
            <span className="text-base font-semibold">{activeSponsor.name}</span>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        ) : (
          <div className="flex items-center justify-center gap-5">
            {logo ? (
              <Image src={logo} alt={`${activeSponsor.name} logo`} width={160} height={72} sizes="160px" unoptimized className="max-h-[72px] w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-background text-xl font-bold">{activeSponsor.name.slice(0, 2).toUpperCase()}</span>
            )}
            <span className="text-base font-semibold">{activeSponsor.name}</span>
          </div>
        )}
      </div>
    </section>
  );
}
