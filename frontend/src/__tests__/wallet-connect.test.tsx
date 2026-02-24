import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WalletConnectCard } from "@/components/wallet/WalletConnectCard";
import { WalletProvider } from "@/hooks/useWallet";
import {
  connectAlbedo,
  connectFreighter,
  disconnect,
  getStoredWalletSession,
} from "@/lib/wallet/connectors";

jest.mock("@/lib/wallet/connectors", () => ({
  connectFreighter: jest.fn(),
  connectAlbedo: jest.fn(),
  disconnect: jest.fn(),
  getStoredWalletSession: jest.fn(),
}));

const mockedConnectFreighter = connectFreighter as jest.MockedFunction<
  typeof connectFreighter
>;
const mockedConnectAlbedo = connectAlbedo as jest.MockedFunction<
  typeof connectAlbedo
>;
const mockedDisconnect = disconnect as jest.MockedFunction<typeof disconnect>;
const mockedGetStoredSession = getStoredWalletSession as jest.MockedFunction<
  typeof getStoredWalletSession
>;

const renderWalletConnect = () => {
  return render(
    <WalletProvider>
      <WalletConnectCard onOpenDeposit={jest.fn()} onOpenWithdraw={jest.fn()} />
    </WalletProvider>,
  );
};

describe("Wallet connect UI", () => {
  beforeEach(() => {
    mockedGetStoredSession.mockReturnValue(null);
    mockedConnectFreighter.mockReset();
    mockedConnectAlbedo.mockReset();
    mockedDisconnect.mockReset();
  });

  it("transitions from disconnected to connected and disconnects for Freighter", async () => {
    mockedConnectFreighter.mockResolvedValue({
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      walletType: "freighter",
      network: "testnet",
      connectedAt: new Date().toISOString(),
    });

    renderWalletConnect();

    fireEvent.click(screen.getByRole("button", { name: /connect freighter/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
    });

    expect(screen.getByText("freighter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(mockedDisconnect).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /connect freighter/i }),
    ).toBeInTheDocument();
  });

  it("transitions to connected state for Albedo", async () => {
    mockedConnectAlbedo.mockResolvedValue({
      publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBZ6H",
      walletType: "albedo",
      network: "testnet",
      connectedAt: new Date().toISOString(),
    });

    renderWalletConnect();

    fireEvent.click(screen.getByRole("button", { name: /connect albedo/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
    });

    expect(screen.getByText("albedo")).toBeInTheDocument();
  });
});
