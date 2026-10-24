"use client";

import { TxHistoryItem } from "@/lib/wallet/types";
import { CopyButton } from "@/components/common/CopyButton";
import { truncateAddress } from "./AddressDisplay";

interface TransactionRowProps {
  item: TxHistoryItem;
}

const formatTimestamp = (value: string) => {
  return new Date(value).toLocaleString();
};

const statusStyles: Record<TxHistoryItem["status"], string> = {
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/25 dark:text-amber-100",
  success:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100",
  failed: "bg-destructive/10 text-red-900 dark:bg-destructive/20/25 dark:text-destructive-foreground",
};

/** One transaction in the wallet history, with a copyable hash (Issue #1336). */
export function TransactionRow({ item }: TransactionRowProps) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium capitalize">
          {item.direction}{" "}
          {item.amount.toLocaleString("en-US", {
            maximumFractionDigits: 7,
          })}{" "}
          {item.asset}
        </p>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyles[item.status]}`}
        >
          {item.status}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{formatTimestamp(item.timestamp)}</span>
        {item.phase && <span>Phase: {item.phase}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {item.hash && (
          <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
            Hash:{" "}
            <span title={item.hash}>{truncateAddress(item.hash, 8)}</span>
            <CopyButton
              value={item.hash}
              label="transaction hash"
              successMessage="Transaction hash copied"
            />
          </span>
        )}
        {item.explorerUrl && (
          <a
            href={item.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline dark:text-primary/80"
          >
            View Explorer
          </a>
        )}
      </div>

      {item.reason && (
        <p className="text-xs text-destructive">{item.reason}</p>
      )}
    </div>
  );
}
