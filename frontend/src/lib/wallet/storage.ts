import { WalletSession } from "@/lib/wallet/types";

export const WALLET_SESSION_STORAGE_KEY = "arenax_wallet_session";

const isWalletSession = (value: unknown): value is WalletSession => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WalletSession>;
  return (
    typeof candidate.publicKey === "string" &&
    (candidate.walletType === "freighter" || candidate.walletType === "albedo") &&
    (candidate.network === "testnet" || candidate.network === "mainnet") &&
    typeof candidate.connectedAt === "string"
  );
};

// sessionStorage, not localStorage (#1098): a connected wallet's public key
// should not persist past the tab closing — localStorage would leave it
// readable by any script in this origin indefinitely, including after the
// browser restarts.
export const readWalletSession = (): WalletSession | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = sessionStorage.getItem(WALLET_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isWalletSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeWalletSession = (session: WalletSession | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!session) {
    sessionStorage.removeItem(WALLET_SESSION_STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(WALLET_SESSION_STORAGE_KEY, JSON.stringify(session));
};
