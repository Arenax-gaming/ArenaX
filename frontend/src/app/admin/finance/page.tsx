"use client";

import React, { useEffect, useState, useCallback } from "react";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Transaction {
  id: string;
  type: "deposit" | "withdrawal" | "entry_fee" | "prize_payout" | "refund" | string;
  amount: number;
  currency: string;
  userId: string;
  username?: string;
  status: "pending" | "completed" | "failed" | string;
  description?: string;
  createdAt: string;
}

interface RevenueSummary {
  totalRevenue: number;
  totalPayouts: number;
  netRevenue: number;
  totalDeposits: number;
  totalWithdrawals: number;
  pendingTransactions: number;
}

const TX_TYPE_COLORS: Record<string, string> = {
  deposit: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  withdrawal: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  entry_fee: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  prize_payout: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  refund: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

const TX_STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

async function fetchAdminData<T>(path: string): Promise<T | null> {
  try {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token")
        : null;
    const res = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function FinanceDashboard() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const PAGE_SIZE = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (filterType !== "all") params.set("type", filterType);
      if (filterStatus !== "all") params.set("status", filterStatus);

      const [summaryData, txData] = await Promise.all([
        fetchAdminData<RevenueSummary>("/api/admin/finance/summary"),
        fetchAdminData<{ transactions: Transaction[]; total: number }>(`/api/admin/finance/transactions?${params}`),
      ]);

      setSummary(summaryData);
      const txList = txData?.transactions ?? [];
      setTransactions(txList);
      setHasMore(txList.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filterType, filterStatus]);

  const summaryCards = summary
    ? [
        { label: "Total Revenue", value: formatCurrency(summary.totalRevenue), color: "text-green-600 dark:text-green-400" },
        { label: "Total Payouts", value: formatCurrency(summary.totalPayouts), color: "text-red-600 dark:text-red-400" },
        { label: "Net Revenue", value: formatCurrency(summary.netRevenue), color: summary.netRevenue >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400" },
        { label: "Total Deposits", value: formatCurrency(summary.totalDeposits), color: "text-blue-600 dark:text-blue-400" },
        { label: "Total Withdrawals", value: formatCurrency(summary.totalWithdrawals), color: "text-orange-600 dark:text-orange-400" },
        { label: "Pending Transactions", value: String(summary.pendingTransactions), color: "text-yellow-600 dark:text-yellow-400" },
      ]
    : [];

  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
            Finance
          </h1>
          <p className="text-xl text-muted-foreground">
            Revenue summary and transaction log.
          </p>
        </header>

        {/* Revenue summary cards */}
        {summary ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {summaryCards.map((card) => (
              <Card key={card.label} className="border">
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardDescription className="text-xs uppercase tracking-wider">{card.label}</CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !loading ? (
          <Card className="bg-muted/30 border-dashed border-2">
            <CardContent className="flex items-center justify-center h-24 text-muted-foreground text-sm">
              Revenue summary unavailable — connect <code className="bg-muted px-1 rounded mx-1">GET /api/admin/finance/summary</code> to enable.
            </CardContent>
          </Card>
        ) : null}

        {/* Transaction log */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold">Transaction Log</h2>
            <div className="flex items-center gap-2 ml-auto">
              <label htmlFor="type-filter" className="text-sm text-muted-foreground">Type:</label>
              <select
                id="type-filter"
                className="bg-background border border-input h-9 px-2 rounded-md text-sm"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="all">All</option>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="entry_fee">Entry Fee</option>
                <option value="prize_payout">Prize Payout</option>
                <option value="refund">Refund</option>
              </select>
              <label htmlFor="status-filter" className="text-sm text-muted-foreground">Status:</label>
              <select
                id="status-filter"
                className="bg-background border border-input h-9 px-2 rounded-md text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading transactions…</div>
          ) : transactions.length === 0 ? (
            <Card className="bg-muted/50 border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <p>No transactions found.</p>
                <p className="text-xs mt-1">Connect <code className="bg-muted px-1 rounded">GET /api/admin/finance/transactions</code> to populate this log.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">ID</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">User</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Type</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Amount</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Description</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{tx.id.substring(0, 8)}…</td>
                        <td className="px-4 py-3 font-medium">{tx.username ?? tx.userId.substring(0, 8)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${TX_TYPE_COLORS[tx.type] ?? "bg-gray-100 text-gray-700"}`}>
                            {tx.type.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${tx.type === "withdrawal" || tx.type === "prize_payout" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                          {tx.type === "withdrawal" || tx.type === "prize_payout" ? "-" : "+"}
                          {formatCurrency(tx.amount, tx.currency ?? "USD")}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${TX_STATUS_COLORS[tx.status] ?? "bg-gray-100 text-gray-700"}`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">{tx.description ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">Page {page}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasMore || loading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </ProtectedPage>
  );
}
