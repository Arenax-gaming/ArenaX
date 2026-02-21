import { walletConfig } from "@/lib/wallet/config";
import {
  AssetBalance,
  WalletAssetCode,
  WalletBalances,
} from "@/lib/wallet/types";

interface HorizonBalanceLine {
  asset_type: string;
  balance: string;
  asset_code?: string;
  asset_issuer?: string;
}

interface HorizonAccountResponse {
  balances: HorizonBalanceLine[];
}

type LockedBalanceRecord = Record<WalletAssetCode, number>;

const ASSET_CODES: WalletAssetCode[] = ["XLM", "USDC", "ARENAX"];

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const emptyLockedBalances = (): LockedBalanceRecord => ({
  XLM: 0,
  USDC: 0,
  ARENAX: 0,
});

const buildAssetBalance = (
  asset: WalletAssetCode,
  available: number,
  locked: number,
  hasTrustline: boolean,
): AssetBalance => {
  const config = walletConfig.assets[asset];

  return {
    asset,
    available,
    locked,
    total: available + locked,
    hasTrustline,
    source: config.source,
    issuer: config.issuer,
    contractId: config.contractId,
  };
};

const resolveUrl = (endpoint: string, publicKey: string) => {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL(endpoint, origin);
  url.searchParams.set("address", publicKey);
  return url.toString();
};

const normalizeLockedBalances = (raw: unknown): LockedBalanceRecord => {
  if (!raw || typeof raw !== "object") {
    return emptyLockedBalances();
  }

  const response = raw as Record<string, unknown>;
  const lockedNode =
    response.locked && typeof response.locked === "object"
      ? (response.locked as Record<string, unknown>)
      : response;

  return {
    XLM: toNumber(lockedNode.XLM),
    USDC: toNumber(lockedNode.USDC),
    ARENAX: toNumber(lockedNode.ARENAX),
  };
};

const fetchHorizonAccount = async (
  publicKey: string,
): Promise<HorizonAccountResponse | null> => {
  const response = await fetch(
    `${walletConfig.horizonUrl.replace(/\/$/, "")}/accounts/${publicKey}`,
    { cache: "no-store" },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Unable to load wallet balances from Horizon.");
  }

  return (await response.json()) as HorizonAccountResponse;
};

const findClassicTrustline = (
  balanceLines: HorizonBalanceLine[],
  assetCode: WalletAssetCode,
  issuer?: string,
): HorizonBalanceLine | undefined => {
  return balanceLines.find((line) => {
    if (line.asset_type === "native") {
      return false;
    }

    if (line.asset_code !== assetCode) {
      return false;
    }

    if (issuer) {
      return line.asset_issuer === issuer;
    }

    return true;
  });
};

const fetchArenaxSorobanBalance = async (publicKey: string): Promise<number> => {
  const endpoint = walletConfig.arenaxSorobanBalanceEndpoint;
  if (!endpoint) {
    return 0;
  }

  try {
    const response = await fetch(resolveUrl(endpoint, publicKey), {
      cache: "no-store",
    });
    if (!response.ok) {
      return 0;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return toNumber(payload.balance);
  } catch {
    return 0;
  }
};

export const fetchLockedBalances = async (
  publicKey: string,
): Promise<LockedBalanceRecord> => {
  const endpoint = walletConfig.escrowBalancesEndpoint;
  if (!endpoint) {
    return emptyLockedBalances();
  }

  try {
    const response = await fetch(resolveUrl(endpoint, publicKey), {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return emptyLockedBalances();
    }

    const payload = (await response.json()) as unknown;
    return normalizeLockedBalances(payload);
  } catch {
    return emptyLockedBalances();
  }
};

export const fetchWalletBalances = async (
  publicKey: string,
): Promise<WalletBalances> => {
  const [account, locked] = await Promise.all([
    fetchHorizonAccount(publicKey),
    fetchLockedBalances(publicKey),
  ]);

  const lines = account?.balances ?? [];

  const xlmLine = lines.find((line) => line.asset_type === "native");
  const xlmAvailable = toNumber(xlmLine?.balance);

  const usdcTrustline = findClassicTrustline(
    lines,
    "USDC",
    walletConfig.assets.USDC.issuer,
  );
  const usdcAvailable = toNumber(usdcTrustline?.balance);

  const arenaConfig = walletConfig.assets.ARENAX;

  let arenaxAvailable = 0;
  let arenaxTrustline = true;

  if (arenaConfig.source === "soroban") {
    arenaxAvailable = await fetchArenaxSorobanBalance(publicKey);
  } else {
    const arenaTrustlineLine = findClassicTrustline(
      lines,
      "ARENAX",
      arenaConfig.issuer,
    );
    arenaxAvailable = toNumber(arenaTrustlineLine?.balance);
    arenaxTrustline = Boolean(arenaTrustlineLine);
  }

  const balances: WalletBalances = {
    XLM: buildAssetBalance("XLM", xlmAvailable, locked.XLM, true),
    USDC: buildAssetBalance(
      "USDC",
      usdcAvailable,
      locked.USDC,
      Boolean(usdcTrustline),
    ),
    ARENAX: buildAssetBalance(
      "ARENAX",
      arenaxAvailable,
      locked.ARENAX,
      arenaxTrustline,
    ),
  };

  if (!account) {
    balances.USDC.hasTrustline = false;
    if (arenaConfig.source === "classic") {
      balances.ARENAX.hasTrustline = false;
    }
  }

  return balances;
};

export const createEmptyBalances = (): WalletBalances => {
  const base = emptyLockedBalances();

  return ASSET_CODES.reduce((acc, asset) => {
    acc[asset] = buildAssetBalance(asset, 0, base[asset], asset === "XLM");
    return acc;
  }, {} as WalletBalances);
};

export const formatAssetAmount = (amount: number) => {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  });
};
