import { act, fireEvent, render, screen } from "@testing-library/react";
import { SponsorCarousel } from "@/components/sponsors/SponsorCarousel";

const mockTrack = jest.fn();
jest.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: mockTrack }),
}));

const sponsors = [
  {
    id: "sponsor-1",
    name: "Acme",
    logoUrl: "https://example.com/acme.png",
    websiteUrl: "https://acme.example",
  },
  {
    id: "sponsor-2",
    name: "Orbit",
    logoUrl: "https://example.com/orbit.png",
    websiteUrl: "https://orbit.example",
  },
];

describe("SponsorCarousel (#1495)", () => {
  beforeEach(() => {
    mockTrack.mockClear();
  });

  it("rotates sponsors at the configured interval", () => {
    jest.useFakeTimers();
    render(<SponsorCarousel sponsors={sponsors} intervalMs={5000} tournamentId="cup-1" />);

    expect(screen.getByTestId("sponsor-slide")).toHaveAttribute("aria-label", "1 of 2: Acme");
    act(() => jest.advanceTimersByTime(5000));
    expect(screen.getByTestId("sponsor-slide")).toHaveAttribute("aria-label", "2 of 2: Orbit");

    jest.useRealTimers();
  });

  it("pauses automatic rotation while the pointer is over the carousel", () => {
    jest.useFakeTimers();
    render(<SponsorCarousel sponsors={sponsors} />);
    const carousel = screen.getByRole("region", { name: "Tournament sponsors" });

    fireEvent.mouseEnter(carousel);
    act(() => jest.advanceTimersByTime(10000));
    expect(screen.getByTestId("sponsor-slide")).toHaveAttribute("aria-label", "1 of 2: Acme");

    fireEvent.mouseLeave(carousel);
    act(() => jest.advanceTimersByTime(5000));
    expect(screen.getByTestId("sponsor-slide")).toHaveAttribute("aria-label", "2 of 2: Orbit");

    jest.useRealTimers();
  });

  it("supports keyboard navigation", () => {
    render(<SponsorCarousel sponsors={sponsors} />);
    fireEvent.keyDown(screen.getByTestId("sponsor-slide"), { key: "ArrowRight" });
    expect(screen.getByTestId("sponsor-slide")).toHaveAttribute("aria-label", "2 of 2: Orbit");
    fireEvent.keyDown(screen.getByTestId("sponsor-slide"), { key: "ArrowLeft" });
    expect(screen.getByTestId("sponsor-slide")).toHaveAttribute("aria-label", "1 of 2: Acme");
  });

  it("tracks sponsor link clicks", () => {
    render(<SponsorCarousel sponsors={sponsors} tournamentId="cup-1" />);
    fireEvent.click(screen.getByRole("link", { name: /Visit Acme/ }));

    expect(mockTrack).toHaveBeenCalledWith("sponsor_clicked", {
      sponsorId: "sponsor-1",
      sponsorName: "Acme",
      tournamentId: "cup-1",
      destination: "https://acme.example",
    });
  });

  it("renders nothing when there are no active sponsors", () => {
    const { container } = render(<SponsorCarousel sponsors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
