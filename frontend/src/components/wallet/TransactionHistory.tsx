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
import { Receipt } from "lucide-react";
import { TransactionRow } from "./TransactionRow";

interface TransactionHistoryProps {
  items: TxHistoryItem[];
  onClear: () => void;
}

type TabType = "all" | "deposits" | "withdrawals" | "earnings";

export function TransactionHistory({
  items,
  onClear,
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
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
              <TransactionRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
