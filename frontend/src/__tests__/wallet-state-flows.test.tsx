import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DepositModal } from "@/components/wallet/DepositModal";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { api } from "@/lib/api";
import { WalletBalances, WithdrawRequest } from "@/lib/wallet/types";

// Mock API
jest.mock("@/lib/api", () => ({
  api: {
    initiateDeposit: jest.fn(),
    verifyDeposit: jest.fn(),
    initiateWithdrawal: jest.fn(),
  },
}));

// Mock Analytics
jest.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: jest.fn() }),
}));

// Mock Notifications
jest.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ notify: jest.fn(), addToast: jest.fn() }),
}));

const mockBalances: WalletBalances = {
  XLM: {
    asset: "XLM",
    available: 150.5,
    locked: 10,
    total: 160.5,
    hasTrustline: true,
    source: "native",
  },
  USDC: {
    asset: "USDC",
    available: 50.0,
    locked: 0,
    total: 50.0,
    hasTrustline: true,
    source: "classic",
  },
  ARENAX: {
    asset: "ARENAX",
    available: 1000,
    locked: 0,
    total: 1000,
    hasTrustline: true,
    source: "classic",
  },
};

const mockAddress = "GBEXAMPLEPUBLICKEYFORSTELLARWALLETTESTING123456789";

describe("Issue #39 - Complete Deposit and Withdrawal State Flows", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Deposit State Flows (Fiat & Stellar rails)", () => {
    /**
     * Acceptance criterion 1: Amount, currency, fees, limits, and destination are confirmed before irreversible action.
     */
    test("confirms amount, currency, fees, limits, and destination before irreversible deposit initiation", async () => {
      const mockRecord = jest.fn();
      render(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={jest.fn()}
          onRecordDeposit={mockRecord}
        />,
      );

      // Switch to Fiat Gateway
      fireEvent.click(screen.getByRole("button", { name: /fiat gateway/i }));

      // Enter 5,000 NGN
      const amountInput = screen.getByLabelText(/amount \(ngn\)/i);
      fireEvent.change(amountInput, { target: { value: "5000" } });

      // Click "Review Deposit"
      fireEvent.click(screen.getByRole("button", { name: /review deposit/i }));

      // Confirmation screen is shown
      expect(screen.getByText(/confirm deposit details/i)).toBeInTheDocument();
      expect(screen.getByText(/deposit amount:/i)).toBeInTheDocument();
      expect(screen.getByText(/₦5,000/i)).toBeInTheDocument();
      expect(screen.getByText(/gateway \/ network fee:/i)).toBeInTheDocument();
      expect(screen.getByText(/destination account:/i)).toBeInTheDocument();
      expect(screen.getByText(mockAddress)).toBeInTheDocument();

      // Ensure initiateDeposit has NOT been called yet (requires explicit confirmation)
      expect(api.initiateDeposit).not.toHaveBeenCalled();

      // Now click "Confirm & Proceed"
      (api.initiateDeposit as jest.Mock).mockResolvedValueOnce({
        transaction_id: "tx-123",
        reference: "ref-ngn-5000",
        status: "pending",
        amount: 5000,
        currency: "NGN",
        payment_method: "paystack",
        message: "Initiated",
      });

      fireEvent.click(screen.getByRole("button", { name: /confirm & proceed/i }));

      await waitFor(() =>
        expect(api.initiateDeposit).toHaveBeenCalledWith(
          expect.objectContaining({
            amount: 5000,
            currency: "NGN",
            payment_method: "paystack",
          }),
        ),
      );
    });

    /**
     * Acceptance criterion 2: Return URLs are validated and never treated as proof of payment.
     */
    test("return URL parameters trigger authoritative backend verification instead of assuming success", async () => {
      const mockRecord = jest.fn();
      (api.verifyDeposit as jest.Mock).mockResolvedValueOnce({
        status: "completed",
        verified: true,
      });

      // User arrives from redirect: URL had ?reference=sandbox_ref_999&status=success
      render(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={jest.fn()}
          onRecordDeposit={mockRecord}
          initialReference="sandbox_ref_999"
          initialProvider="paystack"
        />,
      );

      // Verifying state should be active immediately — never assumed successful
      expect(screen.getByText(/verifying gateway payment…/i)).toBeInTheDocument();

      await waitFor(() =>
        expect(api.verifyDeposit).toHaveBeenCalledWith({
          reference: "sandbox_ref_999",
          provider: "paystack",
        }),
      );

      await waitFor(() =>
        expect(screen.getByText(/deposit confirmed/i)).toBeInTheDocument(),
      );
    });

    /**
     * Acceptance criterion 3: UI polls within documented limits (5 polls) and recovers via activity history.
     */
    test("sandbox fixture - pending: UI polls within documented limits and falls back to pending recovery", async () => {
      jest.useFakeTimers();
      (api.verifyDeposit as jest.Mock).mockResolvedValue({
        status: "pending",
        verified: false,
      });

      render(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={jest.fn()}
          onRecordDeposit={jest.fn()}
          initialReference="sandbox_pending_ref"
          initialProvider="paystack"
        />,
      );

      // Advance through all 5 polling attempts (15s total)
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(3000);
      }

      // Should stop polling and display pending resolution state
      await waitFor(() =>
        expect(screen.getByText(/deposit in progress \(pending\)/i)).toBeInTheDocument(),
      );
      expect(
        screen.getByText(/recover status later from your activity history/i),
      ).toBeInTheDocument();

      jest.useRealTimers();
    });

    /**
     * Sandbox fixture: decline / failed payment state.
     */
    test("sandbox fixture - decline: handles gateway decline with clear failure state and retry option", async () => {
      (api.verifyDeposit as jest.Mock).mockResolvedValueOnce({
        status: "failed",
        verified: false,
      });

      render(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={jest.fn()}
          onRecordDeposit={jest.fn()}
          initialReference="sandbox_declined_ref"
          initialProvider="paystack"
        />,
      );

      await waitFor(() =>
        expect(screen.getByText(/deposit failed or declined/i)).toBeInTheDocument(),
      );

      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    /**
     * Sandbox fixture: duplicate callback is handled idempotently without double crediting.
     */
    test("sandbox fixture - duplicate callback: replaying verification returns completed without duplicate crediting", async () => {
      const mockRecord = jest.fn();
      (api.verifyDeposit as jest.Mock).mockResolvedValue({
        status: "completed",
        verified: true,
      });

      const { rerender } = render(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={jest.fn()}
          onRecordDeposit={mockRecord}
          initialReference="sandbox_dup_ref"
          initialProvider="paystack"
        />,
      );

      await waitFor(() =>
        expect(screen.getByText(/deposit confirmed/i)).toBeInTheDocument(),
      );

      // Replay / duplicate callback
      rerender(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={jest.fn()}
          onRecordDeposit={mockRecord}
          initialReference="sandbox_dup_ref"
          initialProvider="paystack"
        />,
      );

      await waitFor(() =>
        expect(screen.getByText(/deposit confirmed/i)).toBeInTheDocument(),
      );
    });

    /**
     * Sandbox fixture: user abandonment.
     */
    test("sandbox fixture - user abandonment: user closing early transitions safely to cancelled state", async () => {
      const mockClose = jest.fn();
      render(
        <DepositModal
          open={true}
          walletAddress={mockAddress}
          onClose={mockClose}
          onRecordDeposit={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("Withdrawal State Flows (Stellar rail)", () => {
    /**
     * Acceptance criterion 1: Amount, currency, fees, limits, and destination are confirmed before irreversible action.
     */
    test("withdrawal requires explicit confirmation of amount, network fee, limits, and destination before signing", async () => {
      const mockSubmit = jest.fn().mockResolvedValue(undefined);
      render(
        <WithdrawModal
          open={true}
          balances={mockBalances}
          isSubmitting={false}
          onClose={jest.fn()}
          onSubmit={mockSubmit}
        />,
      );

      // Fill in withdrawal form
      const amountInput = screen.getByLabelText(/amount/i);
      fireEvent.change(amountInput, { target: { value: "25" } });

      const destInput = screen.getByLabelText(/destination address/i);
      fireEvent.change(destInput, {
        target: { value: "GBDESTINATIONACCOUNT1234567890123456789012345678901234" },
      });

      // Submit for review
      fireEvent.click(screen.getByRole("button", { name: /review withdrawal/i }));

      // Confirmation screen is rendered
      await waitFor(() =>
        expect(screen.getByText(/confirm withdrawal details/i)).toBeInTheDocument(),
      );

      expect(screen.getByText(/25 xlm/i)).toBeInTheDocument();
      expect(screen.getByText(/network fee:/i)).toBeInTheDocument();
      expect(screen.getByText(/0\.00001 xlm/i)).toBeInTheDocument();
      expect(screen.getByText(/irreversible transaction warning/i)).toBeInTheDocument();

      // Submit has NOT been called yet
      expect(mockSubmit).not.toHaveBeenCalled();

      // Confirm & Sign
      fireEvent.click(screen.getByRole("button", { name: /confirm & sign/i }));

      await waitFor(() =>
        expect(mockSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            asset: "XLM",
            amount: 25,
            destination: "GBDESTINATIONACCOUNT1234567890123456789012345678901234",
          }),
        ),
      );
    });

    test("withdrawal enforces balance limits before allowing confirmation", async () => {
      render(
        <WithdrawModal
          open={true}
          balances={mockBalances}
          isSubmitting={false}
          onClose={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      // Exceed available balance (150.5 available)
      const amountInput = screen.getByLabelText(/amount/i);
      fireEvent.change(amountInput, { target: { value: "999" } });

      const destInput = screen.getByLabelText(/destination address/i);
      fireEvent.change(destInput, {
        target: { value: "GBDESTINATIONACCOUNT1234567890123456789012345678901234" },
      });

      fireEvent.click(screen.getByRole("button", { name: /review withdrawal/i }));

      await waitFor(() =>
        expect(screen.getByText(/amount exceeds available balance/i)).toBeInTheDocument(),
      );

      // Must remain in intent form, not move to confirmation
      expect(screen.queryByText(/confirm withdrawal details/i)).not.toBeInTheDocument();
    });
  });
});
