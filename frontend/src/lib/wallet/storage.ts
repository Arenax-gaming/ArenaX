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

export const readWalletSession = (): WalletSession | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(WALLET_SESSION_STORAGE_KEY);
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
    localStorage.removeItem(WALLET_SESSION_STORAGE_KEY);
    return;
  }

  localStorage.setItem(WALLET_SESSION_STORAGE_KEY, JSON.stringify(session));
};
