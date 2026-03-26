import { render, screen } from "@testing-library/react";
import { BalanceCards } from "@/components/wallet/BalanceCards";
import { fetchWalletBalances } from "@/lib/wallet/balances";

describe("Balance rendering", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders balances from mocked Horizon API response", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            { asset_type: "native", balance: "100.5000000" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: "GUSDCISSUER00000000000000000000000000000000000000000000",
              balance: "22.1000000",
            },
            {
              asset_type: "credit_alphanum12",
              asset_code: "ARENAX",
              asset_issuer: "GARENAXISSUER000000000000000000000000000000000000000000",
              balance: "8.7500000",
            },
          ],
        }),
      } as Response);

    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      writable: true,
    });

    const balances = await fetchWalletBalances(
      "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCE",
    );

    render(<BalanceCards isConnected isLoading={false} balances={balances} />);

    expect(screen.getByTestId("XLM-available")).toHaveTextContent("100.5");
    expect(screen.getByTestId("USDC-available")).toHaveTextContent("22.1");
    expect(screen.getByTestId("ARENAX-available")).toHaveTextContent("8.75");
    expect(screen.getByTestId("USDC-locked")).toHaveTextContent("0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
