import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TournamentCreationWizard } from "@/components/tournaments/TournamentCreationWizard";
import { api } from "@/lib/api";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock("@/lib/api", () => ({
  api: {
    createTournament: jest.fn().mockResolvedValue({ id: "t-new", name: "New Tournament" }),
  },
}));

describe("Tournament Creation Wizard (Issue #1427)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it("renders wizard with step 1 details and progress indicator", () => {
    render(<TournamentCreationWizard />);
    expect(screen.getByTestId("tournament-creation-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-progress-bar")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-details")).toBeInTheDocument();
    expect(screen.getByTestId("step-details-content")).toBeInTheDocument();
  });

  it("validates step 1 before allowing next and shows inline errors", async () => {
    render(<TournamentCreationWizard />);

    const nextBtn = screen.getByText(/Next Step/i);
    // Click Next with empty name
    fireEvent.click(nextBtn);

    expect(
      screen.getByText(/Tournament name must be at least 3 characters/i)
    ).toBeInTheDocument();

    // Fill valid name
    const nameInput = screen.getByLabelText(/Tournament Name/i);
    fireEvent.change(nameInput, { target: { value: "Apex Legends Winter Cup" } });

    fireEvent.click(nextBtn);

    // Should now be on step 2 (Format)
    await waitFor(() => {
      expect(screen.getByTestId("step-format-content")).toBeInTheDocument();
    });
  });

  it("preserves draft state in sessionStorage", async () => {
    render(<TournamentCreationWizard />);

    const nameInput = screen.getByLabelText(/Tournament Name/i);
    fireEvent.change(nameInput, { target: { value: "Restored Cup" } });

    const saved = sessionStorage.getItem("arenax_tournament_create_draft");
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!);
    expect(parsed.formData.name).toBe("Restored Cup");
  });

  it("completes all steps to review screen and submits API call", async () => {
    render(<TournamentCreationWizard />);

    // Step 1: Details
    fireEvent.change(screen.getByLabelText(/Tournament Name/i), {
      target: { value: "Full Wizard Cup" },
    });
    fireEvent.click(screen.getByText(/Next Step/i));

    // Step 2: Format
    await waitFor(() => expect(screen.getByTestId("step-format-content")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Next Step/i));

    // Step 3: Prizes
    await waitFor(() => expect(screen.getByTestId("step-prizes-content")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Next Step/i));

    // Step 4: Schedule
    await waitFor(() => expect(screen.getByTestId("step-schedule-content")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Registration Opens/i), {
      target: { value: "2026-11-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/Registration Closes/i), {
      target: { value: "2026-11-05T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/Tournament Starts/i), {
      target: { value: "2026-11-06T10:00" },
    });
    fireEvent.click(screen.getByText(/Next Step/i));

    // Step 5: Review
    await waitFor(() => expect(screen.getByTestId("step-review-content")).toBeInTheDocument());
    expect(screen.getByText("Full Wizard Cup")).toBeInTheDocument();

    // Submit
    const submitBtn = screen.getByTestId("create-tournament-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Tournament Created Successfully/i)).toBeInTheDocument();
    });
  });
});
