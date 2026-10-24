import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TournamentList } from "@/components/tournaments/TournamentList";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import type { Tournament } from "@/types/tournament";

jest.mock("@/components/tournaments/TournamentCardWithQuickJoin", () => ({
  TournamentCardWithQuickJoin: ({ tournament }: { tournament: Tournament }) => (
    <div data-testid="tournament-card">{tournament.name}</div>
  ),
}));

describe("TournamentList states (#1317)", () => {
  it("renders the loading state", () => {
    const { container } = render(<TournamentList tournaments={[]} isLoading />);
    expect(container).toMatchSnapshot();
  });

  it("renders the empty state with a CTA", () => {
    const onReset = jest.fn();
    const { container } = render(<TournamentList tournaments={[]} onResetFilters={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(onReset).toHaveBeenCalled();
    expect(container).toMatchSnapshot();
  });

  it("renders the error state and retries", () => {
    const onRetry = jest.fn();
    const { container } = render(<TournamentList tournaments={[]} isError onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
    expect(container).toMatchSnapshot();
  });

  it("renders the success state", () => {
    const tournaments = [{ id: "t1", name: "Cup" } as unknown as Tournament];
    render(<TournamentList tournaments={tournaments} />);
    expect(screen.getByRole("list", { name: "Tournaments" })).toBeInTheDocument();
  });

  it("EmptyState and ErrorState accept localised strings", () => {
    const { container } = render(
      <>
        <EmptyState title="Aucun tournoi" />
        <ErrorState title="Échec" retryLabel="Réessayer" onRetry={() => {}} />
      </>,
    );
    expect(screen.getByText("Réessayer")).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });
});
