"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { TxHistoryItem } from "@/lib/wallet/types";
import { Receipt, RefreshCw, ExternalLink } from "lucide-react";

interface TransactionHistoryProps {
  items: TxHistoryItem[];
  onClear: () => void;
  onVerifyItem?: (reference: string, provider?: string) => void;
}

type TabType = "all" | "deposits" | "withdrawals" | "earnings";

const formatTimestamp = (value: string) => {
  return new Date(value).toLocaleString();
};

const statusStyles: Record<TxHistoryItem["status"], string> = {
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/25 dark:text-amber-100 border border-amber-300 dark:border-amber-800",
  success:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-800",
  failed:
    "bg-destructive/10 text-red-900 dark:bg-destructive/20/25 dark:text-destructive-foreground border border-red-300 dark:border-red-900",
};

export function TransactionHistory({
  items,
  onClear,
  onVerifyItem,
}: TransactionHistoryProps) {
  const [activeTab, setActiveTab] = useState<TabType>("all");

  const filteredItems = items.filter((item) => {
    if (activeTab === "all") return true;
    if (activeTab === "deposits") return item.direction === "deposit";
    if (activeTab === "withdrawals") return item.direction === "withdraw";
    if (activeTab === "earnings") return item.direction === "earning";
    return true;
  });

  const tabs: { key: TabType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "deposits", label: "Deposits" },
    { key: "withdrawals", label: "Withdrawals" },
    { key: "earnings", label: "Earnings" },
  ];

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
          <Button variant="ghost" size="sm" onClick={onClear} className="min-h-[36px]">
            Clear
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {/* Tabs with accessible touch targets */}
        <div className="flex gap-2 mb-4 border-b overflow-x-auto pb-1" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px] flex items-center ${
                activeTab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={
              activeTab === "all"
                ? "No transactions yet"
                : `No ${activeTab} yet`
            }
            description={
              activeTab === "all"
                ? "Your transaction history will appear here after you make deposits or withdrawals."
                : `${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} will appear here.`
            }
            size="md"
          />
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="space-y-2 rounded-lg border bg-muted/20 p-3.5 text-sm transition-shadow hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold capitalize text-foreground">
                    {item.direction}{" "}
                    {item.amount.toLocaleString("en-US", {
                      maximumFractionDigits: 7,
                    })}{" "}
                    {item.asset}
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${statusStyles[item.status]}`}
                    >
                      {item.status}
                    </span>
                    {/* Activity History Recovery: Verify Status button (#39) */}
                    {item.status === "pending" && item.reference && onVerifyItem && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onVerifyItem(item.reference!, item.provider)}
                        className="h-7 text-xs gap-1 px-2.5 min-h-[32px]"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Verify Status
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatTimestamp(item.timestamp)}</span>
                  {item.phase && <span>Phase: {item.phase}</span>}
                  {item.reference && (
                    <span className="font-mono">Ref: {item.reference}</span>
                  )}
                  {item.provider && (
                    <span className="capitalize">Provider: {item.provider}</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {item.hash && (
                    <span className="font-mono text-muted-foreground break-all">
                      Hash: {item.hash}
                    </span>
                  )}
                  {item.explorerUrl && (
                    <a
                      href={item.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline dark:text-primary/80 inline-flex items-center gap-1 min-h-[32px]"
                    >
                      View Explorer <ExternalLink className="h-3 w-3" />
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
