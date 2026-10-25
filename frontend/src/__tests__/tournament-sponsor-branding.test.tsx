import React from "react";
import { render, screen } from "@testing-library/react";
import { TournamentCard } from "@/components/tournaments/TournamentCard";
import { TournamentHeader } from "@/components/tournaments/TournamentHeader";
import {
  TournamentSponsorBadge,
  TournamentSponsorRow,
} from "@/components/sponsors/TournamentSponsorBadges";
import { Tournament } from "@/types/tournament";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock("@/hooks/useTournamentPrefetch", () => ({
  useTournamentPrefetch: () => ({
    schedule: jest.fn(),
    cancelScheduled: jest.fn(),
  }),
}));

const nonSponsoredTournament: Tournament = {
  id: "t-nonsponsored",
  name: "Community Cup",
  description: "Standard community tournament",
  gameType: "CS2",
  tournamentType: "single_elimination",
  entryFee: 0,
  prizePool: 1000,
  maxParticipants: 16,
  currentParticipants: 8,
  status: "registration_open",
  visibility: "public",
  startTime: "2026-11-01T10:00:00Z",
  createdBy: "admin",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};

const sponsoredTournament: Tournament = {
  ...nonSponsoredTournament,
  id: "t-sponsored",
  name: "Pro Championship",
  sponsors: [
    {
      id: "sp-1",
      name: "Razer",
      logoUrl: "https://example.com/razer.png",
      brandColor: "#00ff00",
      tier: "title",
      isActive: true,
    },
    {
      id: "sp-2",
      name: "RedBull",
      logoUrl: "https://example.com/redbull.png",
      brandColor: "#0000ff",
      tier: "presenting",
      isActive: true,
    },
  ],
};

describe("Tournament Sponsor Branding (Issue #1425)", () => {
  it("renders sponsor badge on tournament card when sponsorship is active", () => {
    render(<TournamentCard tournament={sponsoredTournament} />);
    const badge = screen.getByTestId("tournament-sponsor-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Razer");
  });

  it("degrades gracefully without sponsor badge for non-sponsored tournament card", () => {
    render(<TournamentCard tournament={nonSponsoredTournament} />);
    expect(screen.queryByTestId("tournament-sponsor-badge")).not.toBeInTheDocument();
  });

  it("displays sponsor logo and presented by badge in TournamentHeader", () => {
    render(<TournamentHeader tournament={sponsoredTournament} bannerSizes="100vw" />);
    expect(screen.getByText(/Presented by Razer/i)).toBeInTheDocument();
  });

  it("renders multiple sponsors row/carousel with logos and tier", () => {
    render(<TournamentSponsorRow tournament={sponsoredTournament} />);
    expect(screen.getByTestId("tournament-sponsors-section")).toBeInTheDocument();
    expect(screen.getByText("Razer")).toBeInTheDocument();
    expect(screen.getByText("RedBull")).toBeInTheDocument();
    expect(screen.getByText(/Title Partner/i)).toBeInTheDocument();
    expect(screen.getByText(/Presenting Partner/i)).toBeInTheDocument();
  });

  it("degrades gracefully and renders null for non-sponsored tournament sponsor row", () => {
    const { container } = render(<TournamentSponsorRow tournament={nonSponsoredTournament} />);
    expect(container).toBeEmptyDOMElement();
  });
});
