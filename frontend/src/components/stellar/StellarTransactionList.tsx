import { ExternalLink } from "lucide-react";
import {
  formatStroops,
  isPrizeDistribution,
  stellarExplorerUrl,
  type StellarTransactionRecord,
} from "@/lib/stellarExplorer";

interface StellarTransactionListProps {
  transactions: StellarTransactionRecord[];
  emptyLabel?: string;
}

export function StellarTransactionList({
  transactions,
  emptyLabel = "No on-chain transactions recorded yet.",
}: StellarTransactionListProps) {
  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3">
      {transactions.map((tx) => (
        <li
          key={tx.transaction_hash}
          className="flex flex-col gap-1 rounded-2xl border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {isPrizeDistribution(tx) ? "Prize distribution" : "Entry fee"} ·{" "}
              {formatStroops(tx.amount, tx.asset_code)}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {tx.transaction_hash}
            </p>
          </div>
          <a
            href={tx.explorer_url ?? stellarExplorerUrl(tx.transaction_hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-700 hover:underline"
            aria-label={`View transaction ${tx.transaction_hash} on Stellar explorer`}
          >
            Explorer
            <ExternalLink className="h-3 w-3" />
          </a>
        </li>
      ))}
    </ul>
  );
}
