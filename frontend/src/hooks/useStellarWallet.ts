"use client";

/**
 * useStellarWallet (#1098)
 *
 * Single hook abstracting over both installed Stellar wallet providers —
 * previously `@stellar/freighter-api` and `@albedo-link/intent` were each
 * wired up ad hoc with no shared connect/disconnect/sign surface. `connect()`
 * auto-detects: Freighter if its browser extension is present, Albedo's
 * popup intent flow otherwise.
 */

import { useCallback, useEffect, useState } from "react";
import freighterApi from "@stellar/freighter-api";
import {
  connectAlbedo,
  connectFreighter,
  disconnect as clearWalletSession,
  getAlbedoClient,
  getStoredWalletSession,
} from "@/lib/wallet/connectors";
import type { WalletType } from "@/lib/wallet/types";

declare global {
  interface Window {
    /** Injected by the Freighter browser extension when installed. */
    freighter?: unknown;
  }
}

export interface UseStellarWalletReturn {
  publicKey: string | null;
  provider: WalletType | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

/** True when the Freighter extension has injected itself into the page. */
function hasFreighterExtension(): boolean {
  return typeof window !== "undefined" && typeof window.freighter !== "undefined";
}

export function useStellarWallet(): UseStellarWalletReturn {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [provider, setProvider] = useState<WalletType | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a session persisted earlier this tab (sessionStorage — cleared
  // on tab close, see lib/wallet/storage.ts).
  useEffect(() => {
    const session = getStoredWalletSession();
    if (session) {
      setPublicKey(session.publicKey);
      setProvider(session.walletType);
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const session = hasFreighterExtension()
        ? await connectFreighter()
        : await connectAlbedo();
      setPublicKey(session.publicKey);
      setProvider(session.walletType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    // Freighter's API has no programmatic "revoke" call — a site's
    // permission can only be revoked from the extension's own UI. This
    // clears everything ArenaX itself holds: the cached public key.
    clearWalletSession();
    setPublicKey(null);
    setProvider(null);
    setError(null);
  }, []);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!publicKey || !provider) {
        throw new Error("No wallet connected.");
      }

      if (provider === "freighter") {
        const result = await freighterApi.signTransaction(xdr, { address: publicKey });
        if (result.error) {
          throw new Error(result.error.message || "Freighter declined to sign the transaction.");
        }
        return result.signedTxXdr;
      }

      const albedo = await getAlbedoClient();
      const result = await albedo.tx({ xdr, pubkey: publicKey, submit: false });
      if (!result.signed_envelope_xdr) {
        throw new Error("Albedo declined to sign the transaction.");
      }
      return result.signed_envelope_xdr;
    },
    [publicKey, provider],
  );

  return { publicKey, provider, connecting, error, connect, disconnect, signTransaction };
}
