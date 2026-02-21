import freighterApi from "@stellar/freighter-api";
import { walletConfig } from "@/lib/wallet/config";
import { readWalletSession, writeWalletSession } from "@/lib/wallet/storage";
import { WalletSession } from "@/lib/wallet/types";

interface AlbedoLike {
  publicKey: (params?: { token?: string; require_existing?: boolean }) => Promise<{
    pubkey?: string;
  }>;
  tx: (params: {
    xdr: string;
    network?: string;
    submit?: boolean;
    pubkey?: string;
    description?: string;
  }) => Promise<{
    tx_hash?: string;
    signed_envelope_xdr?: string;
  }>;
}

declare global {
  interface Window {
    albedo?: AlbedoLike;
  }
}

const ensureFreighterAllowed = async () => {
  const allowedResult = await freighterApi.setAllowed();

  if (allowedResult.error) {
    throw new Error(allowedResult.error.message || "Freighter access was denied.");
  }

  if (!allowedResult.isAllowed) {
    throw new Error("Freighter access was denied.");
  }
};

const buildSession = (publicKey: string, walletType: WalletSession["walletType"]): WalletSession => ({
  publicKey,
  walletType,
  network: walletConfig.network,
  connectedAt: new Date().toISOString(),
});

const loadAlbedo = async (): Promise<AlbedoLike> => {
  if (typeof window === "undefined") {
    throw new Error("Albedo requires a browser environment.");
  }

  if (window.albedo) {
    return window.albedo;
  }

  await import("@albedo-link/intent/lib/albedo.intent.js");

  if (!window.albedo) {
    throw new Error("Albedo client is unavailable.");
  }

  return window.albedo;
};

export const connectFreighter = async (): Promise<WalletSession> => {
  if (typeof window === "undefined") {
    throw new Error("Freighter requires a browser environment.");
  }

  await ensureFreighterAllowed();

  const addressResult = await freighterApi.getAddress();
  if (addressResult.error || !addressResult.address) {
    throw new Error(
      addressResult.error?.message || "Unable to read address from Freighter.",
    );
  }

  const nextSession = buildSession(addressResult.address, "freighter");
  writeWalletSession(nextSession);

  return nextSession;
};

export const connectAlbedo = async (): Promise<WalletSession> => {
  const albedo = await loadAlbedo();
  const keyResult = await albedo.publicKey({
    token: "arenax_wallet_connect",
    require_existing: false,
  });

  if (!keyResult.pubkey) {
    throw new Error("Unable to read address from Albedo.");
  }

  const nextSession = buildSession(keyResult.pubkey, "albedo");
  writeWalletSession(nextSession);

  return nextSession;
};

export const disconnect = () => {
  writeWalletSession(null);
};

export const getStoredWalletSession = () => readWalletSession();

export const isFreighterInstalled = async () => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const result = await freighterApi.isConnected();
    return Boolean(result.isConnected && !result.error);
  } catch {
    return false;
  }
};

export const getAlbedoClient = loadAlbedo;
