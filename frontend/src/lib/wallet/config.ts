import { Networks } from "@stellar/stellar-sdk";
import { AssetConfig, StellarNetwork, TxKind, WalletAssetCode } from "@/lib/wallet/types";

const rawNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK?.toLowerCase() ?? "testnet";

const network: StellarNetwork =
  rawNetwork === "mainnet" || rawNetwork === "public" ? "mainnet" : "testnet";

const isMainnet = network === "mainnet";

const defaultHorizon = isMainnet
  ? "https://horizon.stellar.org"
  : "https://horizon-testnet.stellar.org";

const defaultSorobanRpc = isMainnet
  ? "https://soroban-mainnet.stellar.org"
  : "https://soroban-testnet.stellar.org";

const arenaxIssuer = process.env.NEXT_PUBLIC_ARENAX_ISSUER;
const arenaxContractId = process.env.NEXT_PUBLIC_ARENAX_CONTRACT_ID;

const arenaxSource: AssetConfig["source"] =
  arenaxContractId && !arenaxIssuer ? "soroban" : "classic";

const explorerNetworkSegment = isMainnet ? "public" : "testnet";

const defaultStellarExplorerBase = `https://stellar.expert/explorer/${explorerNetworkSegment}/tx`;
const defaultSorobanExplorerBase = `https://stellar.expert/explorer/${explorerNetworkSegment}/tx`;

export const walletConfig = {
  network,
  networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
  horizonUrl: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? defaultHorizon,
  sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? defaultSorobanRpc,
  stellarExplorerBase:
    process.env.NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL ??
    defaultStellarExplorerBase,
  sorobanExplorerBase:
    process.env.NEXT_PUBLIC_SOROBAN_EXPLORER_BASE_URL ??
    defaultSorobanExplorerBase,
  escrowBalancesEndpoint: process.env.NEXT_PUBLIC_ESCROW_BALANCES_ENDPOINT,
  arenaxSorobanBalanceEndpoint:
    process.env.NEXT_PUBLIC_ARENAX_SOROBAN_BALANCE_ENDPOINT,
  assets: {
    XLM: {
      code: "XLM",
      source: "native",
      issuer: undefined,
      contractId: undefined,
    },
    USDC: {
      code: "USDC",
      source: "classic",
      issuer: process.env.NEXT_PUBLIC_USDC_ISSUER,
      contractId: undefined,
    },
    ARENAX: {
      code: "ARENAX",
      source: arenaxSource,
      issuer: arenaxIssuer,
      contractId: arenaxContractId,
    },
  } satisfies Record<WalletAssetCode, AssetConfig>,
};

export const buildExplorerLink = (hash: string, kind: TxKind = "classic") => {
  const base =
    kind === "soroban"
      ? walletConfig.sorobanExplorerBase
      : walletConfig.stellarExplorerBase;

  return `${base.replace(/\/$/, "")}/${encodeURIComponent(hash)}`;
};
