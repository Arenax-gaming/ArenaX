"use client";

import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { TxHistoryItem } from "@/lib/wallet/types";

interface TransactionHistoryProps {
  items: TxHistoryItem[];
  onClear: () => void;
}

const formatTimestamp = (value: string) => {
  return new Date(value).toLocaleString();
};

const statusStyles: Record<TxHistoryItem["status"], string> = {
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/25 dark:text-amber-100",
  success:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100",
  failed: "bg-red-100 text-red-900 dark:bg-red-900/25 dark:text-red-100",
};

export function TransactionHistory({ items, onClear }: TransactionHistoryProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>
            Recent deposits and withdrawals tracked in this browser.
          </CardDescription>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium capitalize">
                    {item.direction} {item.amount.toLocaleString("en-US", { maximumFractionDigits: 7 })} {item.asset}
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
                    <span className="font-mono text-muted-foreground">Hash: {item.hash}</span>
                  )}
                  {item.explorerUrl && (
                    <a
                      href={item.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View Explorer
                    </a>
                  )}
                </div>

                {item.reason && (
                  <p className="text-xs text-destructive">{item.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
