export type WalletType = "freighter" | "albedo";

export type StellarNetwork = "testnet" | "mainnet";

export type WalletAssetCode = "XLM" | "USDC" | "ARENAX";

export type AssetSourceType = "native" | "classic" | "soroban";

export type TxKind = "classic" | "soroban";

export type TxDirection = "deposit" | "withdraw";

export type TxStatus = "pending" | "success" | "failed";

export type TxPhase = "signing" | "submitted" | "confirmed";

export interface WalletSession {
  publicKey: string;
  walletType: WalletType;
  network: StellarNetwork;
  connectedAt: string;
}

export interface AssetConfig {
  code: WalletAssetCode;
  source: AssetSourceType;
  issuer?: string;
  contractId?: string;
}

export interface AssetBalance {
  asset: WalletAssetCode;
  available: number;
  locked: number;
  total: number;
  hasTrustline: boolean;
  source: AssetSourceType;
  issuer?: string;
  contractId?: string;
}

export type WalletBalances = Record<WalletAssetCode, AssetBalance>;

export interface WithdrawRequest {
  asset: WalletAssetCode;
  amount: number;
  destination: string;
  memo?: string;
}

export interface TxMeta {
  kind: TxKind;
  direction: TxDirection;
  asset: WalletAssetCode;
  amount: number;
}

export interface TxHistoryItem extends TxMeta {
  id: string;
  status: TxStatus;
  phase?: TxPhase;
  hash?: string;
  explorerUrl?: string;
  reason?: string;
  timestamp: string;
}
