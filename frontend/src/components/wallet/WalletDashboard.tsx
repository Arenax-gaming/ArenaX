"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BalanceCards } from "@/components/wallet/BalanceCards";
import { DepositModal } from "@/components/wallet/DepositModal";
import { TransactionHistory } from "@/components/wallet/TransactionHistory";
import { TransactionToasts } from "@/components/wallet/TransactionToasts";
import { WalletConnectCard } from "@/components/wallet/WalletConnectCard";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { useTxStatus } from "@/hooks/useTxStatus";
import { useWallet } from "@/hooks/useWallet";
import { createEmptyBalances, fetchWalletBalances } from "@/lib/wallet/balances";
import { walletConfig } from "@/lib/wallet/config";
import { submitWithdrawTransaction } from "@/lib/wallet/transactions";
import { WalletAssetCode, WithdrawRequest } from "@/lib/wallet/types";

export function WalletDashboard() {
  const { session, isConnected, publicKey } = useWallet();
  const { history, appendHistory, clearHistory, trackTx } = useTxStatus();

  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  const balancesQuery = useQuery({
    queryKey: ["wallet-balances", publicKey, walletConfig.network],
    enabled: Boolean(publicKey),
    queryFn: async () => {
      if (!publicKey) {
        return createEmptyBalances();
      }

      return fetchWalletBalances(publicKey);
    },
    refetchInterval: 30_000,
  });

  const balances = useMemo(() => {
    return balancesQuery.data ?? createEmptyBalances();
  }, [balancesQuery.data]);

  const handleRecordDeposit = (asset: WalletAssetCode, amount: number) => {
    appendHistory({
      direction: "deposit",
      asset,
      amount,
      status: "pending",
      kind: "classic",
    });
  };

  const handleSubmitWithdraw = async (request: WithdrawRequest) => {
    if (!session) {
      throw new Error("Connect a wallet before withdrawing.");
    }

    setWithdrawSubmitting(true);

    try {
      await trackTx(
        async ({ setPhase }) => {
          return submitWithdrawTransaction({
            wallet: session,
            asset: request.asset,
            amount: request.amount,
            destination: request.destination,
            memo: request.memo,
            onPhaseChange: setPhase,
          });
        },
        {
          title: "Transaction Pending",
          direction: "withdraw",
          kind:
            walletConfig.assets[request.asset].source === "soroban"
              ? "soroban"
              : "classic",
          asset: request.asset,
          amount: request.amount,
        },
      );

      await balancesQuery.refetch();
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="text-muted-foreground">
          Connect your Stellar wallet, track balances, and review transaction status.
        </p>
      </div>

      <WalletConnectCard
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenWithdraw={() => setIsWithdrawOpen(true)}
      />

      {balancesQuery.error && isConnected && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {balancesQuery.error instanceof Error
            ? balancesQuery.error.message
            : "Unable to load balances."}
        </div>
      )}

      <BalanceCards
        isConnected={isConnected}
        isLoading={Boolean(publicKey) && balancesQuery.isLoading}
        balances={balances}
      />

      <TransactionHistory items={history} onClear={clearHistory} />

      {isConnected && publicKey && (
        <>
          <DepositModal
            open={isDepositOpen}
            walletAddress={publicKey}
            onClose={() => setIsDepositOpen(false)}
            onRecordDeposit={handleRecordDeposit}
          />
          <WithdrawModal
            open={isWithdrawOpen}
            balances={balances}
            isSubmitting={withdrawSubmitting}
            onClose={() => setIsWithdrawOpen(false)}
            onSubmit={handleSubmitWithdraw}
          />
        </>
      )}

      <TransactionToasts />
    </div>
  );
}
