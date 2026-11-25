import React from "react";
import { render, screen } from "@testing-library/react";
import {
  TxProgressStepper,
  getActiveStepIndex,
  STEPS,
} from "@/components/stellar/TxProgressStepper";

describe("TxProgressStepper unit tests", () => {
  it("determines correct step index based on phase and status", () => {
    expect(getActiveStepIndex("pending", "signing")).toBe(0);
    expect(getActiveStepIndex("pending", "submitted")).toBe(1);
    expect(getActiveStepIndex("pending", "confirming")).toBe(1);
    expect(getActiveStepIndex("success", "confirmed")).toBe(2);
    expect(getActiveStepIndex("failed", "confirming")).toBe(1);
    expect(getActiveStepIndex("failed", "signing")).toBe(0);
  });

  it("renders all 3 steps: Submitted, Confirming, Confirmed", () => {
    render(<TxProgressStepper status="pending" phase="submitted" />);
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Confirming")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("tx-stepper-in-progress")).toBeInTheDocument();
  });

  it("advances and displays confirming status when phase is confirming", () => {
    render(
      <TxProgressStepper
        status="pending"
        phase="confirming"
        hash="test_stellar_hash_123"
      />
    );
    expect(
      screen.getByText(/Waiting for ledger close confirmation/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Tx: test_stellar_hash_123/i)).toBeInTheDocument();
  });

  it("renders confirmed state when transaction succeeds", () => {
    render(
      <TxProgressStepper
        status="success"
        phase="confirmed"
        hash="test_stellar_hash_confirmed"
      />
    );
    expect(screen.getByTestId("tx-stepper-confirmed")).toBeInTheDocument();
    expect(
      screen.getByText(/Transaction confirmed on Stellar ledger!/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Stellar Expert")).toBeInTheDocument();
  });

  it("renders failed state with Stellar transaction hash and Stellar Expert link", () => {
    render(
      <TxProgressStepper
        status="failed"
        phase="confirming"
        hash="stellar_failed_hash_999"
        reason="Transaction failed: op_underfunded"
        explorerUrl="https://stellar.expert/explorer/testnet/tx/stellar_failed_hash_999"
      />
    );
    expect(screen.getByTestId("tx-stepper-failed")).toBeInTheDocument();
    expect(screen.getByText("Transaction Failed")).toBeInTheDocument();
    expect(
      screen.getByText("Transaction failed: op_underfunded")
    ).toBeInTheDocument();
    expect(screen.getByText("stellar_failed_hash_999")).toBeInTheDocument();

    const explorerLink = screen.getByRole("link", {
      name: /View on Stellar Expert/i,
    });
    expect(explorerLink).toBeInTheDocument();
    expect(explorerLink).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/stellar_failed_hash_999"
    );
  });
});
