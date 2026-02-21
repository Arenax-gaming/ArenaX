"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  connectAlbedo,
  connectFreighter,
  disconnect,
  getStoredWalletSession,
} from "@/lib/wallet/connectors";
import { walletConfig } from "@/lib/wallet/config";
import { writeWalletSession } from "@/lib/wallet/storage";
import { WalletSession, WalletType } from "@/lib/wallet/types";

interface WalletContextValue {
  session: WalletSession | null;
  publicKey: string | null;
  walletType: WalletType | null;
  network: WalletSession["network"];
  isConnected: boolean;
  connectingWallet: WalletType | null;
  error: string | null;
  connectFreighterWallet: () => Promise<void>;
  connectAlbedoWallet: () => Promise<void>;
  disconnectWallet: () => void;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const normalizeSessionNetwork = (session: WalletSession | null) => {
  if (!session) {
    return session;
  }

  if (session.network === walletConfig.network) {
    return session;
  }

  return {
    ...session,
    network: walletConfig.network,
  };
};

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<WalletSession | null>(() =>
    normalizeSessionNetwork(getStoredWalletSession()),
  );
  const [connectingWallet, setConnectingWallet] = useState<WalletType | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (session.network !== walletConfig.network) {
      const normalized = normalizeSessionNetwork(session);
      setSession(normalized);
      writeWalletSession(normalized);
    }
  }, [session]);

  const connectFreighterWallet = useCallback(async () => {
    try {
      setConnectingWallet("freighter");
      setError(null);
      const nextSession = await connectFreighter();
      setSession(nextSession);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to connect Freighter wallet.",
      );
      throw err;
    } finally {
      setConnectingWallet(null);
    }
  }, []);

  const connectAlbedoWallet = useCallback(async () => {
    try {
      setConnectingWallet("albedo");
      setError(null);
      const nextSession = await connectAlbedo();
      setSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect Albedo.");
      throw err;
    } finally {
      setConnectingWallet(null);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setSession(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      publicKey: session?.publicKey ?? null,
      walletType: session?.walletType ?? null,
      network: walletConfig.network,
      isConnected: Boolean(session),
      connectingWallet,
      error,
      connectFreighterWallet,
      connectAlbedoWallet,
      disconnectWallet,
      clearError,
    }),
    [
      session,
      connectingWallet,
      error,
      connectFreighterWallet,
      connectAlbedoWallet,
      disconnectWallet,
      clearError,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }

  return context;
};
