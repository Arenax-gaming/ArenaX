export interface StellarTransactionRecord {
  transaction_hash: string;
  amount: number;
  asset_code: string;
  operation_type: string;
  memo?: string | null;
  status: string;
  created_at: string;
  explorer_url?: string;
}

const STROOPS_PER_UNIT = 10_000_000;

export function stellarExplorerUrl(txHash: string): string {
  const network =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

export function formatStroops(amount: number, asset = "XLM"): string {
  return `${(amount / STROOPS_PER_UNIT).toLocaleString(undefined, {
    maximumFractionDigits: 7,
  })} ${asset}`;
}

export function isPrizeDistribution(tx: StellarTransactionRecord): boolean {
  return (tx.memo ?? "").startsWith("Prize distribution");
}

/** Fetches a tournament's prize-pool transactions (entry fees + payouts). */
export async function fetchTournamentTransactions(
  tournamentId: string,
): Promise<StellarTransactionRecord[]> {
  const origin = process.env.NEXT_PUBLIC_API_URL ?? "";
  const response = await fetch(
    `${origin}/api/stellar/tournaments/${encodeURIComponent(tournamentId)}/transactions`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as StellarTransactionRecord[];
}
