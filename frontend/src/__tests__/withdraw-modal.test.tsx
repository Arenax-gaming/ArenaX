import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { createEmptyBalances } from "@/lib/wallet/balances";

describe("Withdraw validation", () => {
  it("shows validation errors for invalid amount and destination", async () => {
    const balances = createEmptyBalances();
    balances.XLM.available = 5;
    balances.XLM.total = 5;

    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <WithdrawModal
        open
        balances={balances}
        isSubmitting={false}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /submit withdrawal/i }));

    expect(
      screen.getByText(/enter a valid amount greater than 0/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/destination address is required/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText(/destination address/i), {
      target: {
        value: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /submit withdrawal/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/amount exceeds available balance/i),
      ).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
