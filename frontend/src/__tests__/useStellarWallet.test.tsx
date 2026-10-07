/**
 * Unit tests for useStellarWallet (#1098).
 *
 * Covers:
 *  - auto-detection: Freighter mock present -> provider "freighter"
 *  - auto-detection: Freighter absent -> falls back to Albedo, provider "albedo"
 *  - disconnect clears publicKey/provider and the underlying session
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useStellarWallet } from "@/hooks/useStellarWallet";
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
  getAlbedoClient: jest.fn(),
}));

const mockedConnectFreighter = connectFreighter as jest.MockedFunction<typeof connectFreighter>;
const mockedConnectAlbedo = connectAlbedo as jest.MockedFunction<typeof connectAlbedo>;
const mockedDisconnect = disconnect as jest.MockedFunction<typeof disconnect>;
const mockedGetStoredSession = getStoredWalletSession as jest.MockedFunction<
  typeof getStoredWalletSession
>;

describe("useStellarWallet", () => {
  beforeEach(() => {
    mockedGetStoredSession.mockReturnValue(null);
    mockedConnectFreighter.mockReset();
    mockedConnectAlbedo.mockReset();
    mockedDisconnect.mockReset();
    delete (window as { freighter?: unknown }).freighter;
  });

  it("prefers Freighter when window.freighter is available", async () => {
    (window as { freighter?: unknown }).freighter = {};
    mockedConnectFreighter.mockResolvedValue({
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      walletType: "freighter",
      network: "testnet",
      connectedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useStellarWallet());

    await act(async () => {
      await result.current.connect();
    });

    expect(mockedConnectFreighter).toHaveBeenCalledTimes(1);
    expect(mockedConnectAlbedo).not.toHaveBeenCalled();
    expect(result.current.provider).toBe("freighter");
    expect(result.current.publicKey).toBe(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
  });

  it("falls back to Albedo when Freighter is not installed", async () => {
    mockedConnectAlbedo.mockResolvedValue({
      publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBZ6H",
      walletType: "albedo",
      network: "testnet",
      connectedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useStellarWallet());

    await act(async () => {
      await result.current.connect();
    });

    expect(mockedConnectAlbedo).toHaveBeenCalledTimes(1);
    expect(mockedConnectFreighter).not.toHaveBeenCalled();
    expect(result.current.provider).toBe("albedo");
  });

  it("surfaces a connection error without leaving connecting=true", async () => {
    mockedConnectAlbedo.mockRejectedValue(new Error("User rejected"));

    const { result } = renderHook(() => useStellarWallet());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toBe("User rejected");
    expect(result.current.connecting).toBe(false);
    expect(result.current.publicKey).toBeNull();
  });

  it("disconnect clears publicKey/provider and the stored session", async () => {
    (window as { freighter?: unknown }).freighter = {};
    mockedConnectFreighter.mockResolvedValue({
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      walletType: "freighter",
      network: "testnet",
      connectedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useStellarWallet());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.publicKey).not.toBeNull();

    act(() => {
      result.current.disconnect();
    });

    expect(mockedDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.provider).toBeNull();
  });

  it("restores a session already persisted this tab on mount", async () => {
    mockedGetStoredSession.mockReturnValue({
      publicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      walletType: "albedo",
      network: "testnet",
      connectedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useStellarWallet());

    await waitFor(() => expect(result.current.publicKey).not.toBeNull());
    expect(result.current.provider).toBe("albedo");
  });
});
