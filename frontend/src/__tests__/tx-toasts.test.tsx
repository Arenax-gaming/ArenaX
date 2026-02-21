import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransactionToasts } from "@/components/wallet/TransactionToasts";
import { TxStatusProvider, useTxStatus } from "@/hooks/useTxStatus";
import { waitForTransactionConfirmation } from "@/lib/wallet/transactions";

jest.mock("@/lib/wallet/transactions", () => {
  const actual = jest.requireActual("@/lib/wallet/transactions");
  return {
    ...actual,
    waitForTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
  };
});

const mockedWaitForConfirmation =
  waitForTransactionConfirmation as jest.MockedFunction<
    typeof waitForTransactionConfirmation
  >;

function LifecycleHarness({
  run,
}: {
  run: () => Promise<string>;
}) {
  const { trackTx } = useTxStatus();

  return (
    <button
      onClick={() => {
        void trackTx(run(), {
          title: "Transaction Pending",
          direction: "withdraw",
          kind: "classic",
          asset: "XLM",
          amount: 1,
        }).catch(() => undefined);
      }}
    >
      Trigger
    </button>
  );
}

describe("Transaction toast lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedWaitForConfirmation.mockClear();
  });

  it("moves toast from pending to success", async () => {
    let resolveTx: (hash: string) => void = () => undefined;
    const pendingPromise = new Promise<string>((resolve) => {
      resolveTx = resolve;
    });

    render(
      <TxStatusProvider>
        <LifecycleHarness run={() => pendingPromise} />
        <TransactionToasts />
      </TxStatusProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /trigger/i }));

    expect(await screen.findByText("Transaction Pending")).toBeInTheDocument();

    resolveTx("abc123hash");

    await waitFor(() => {
      expect(screen.getByText(/success/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/open explorer/i)).toBeInTheDocument();
    expect(mockedWaitForConfirmation).toHaveBeenCalledWith("abc123hash", "classic");
  });

  it("moves toast from pending to failed with sanitized reason", async () => {
    render(
      <TxStatusProvider>
        <LifecycleHarness run={() => Promise.reject(new Error("wallet rejected"))} />
        <TransactionToasts />
      </TxStatusProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /trigger/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/transaction was rejected in your wallet/i),
    ).toBeInTheDocument();
  });
});
