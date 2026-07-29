"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BalanceCards } from "@/components/wallet/BalanceCards";
import { DepositModal } from "@/components/wallet/DepositModal";
import { SessionExpiredModal } from "@/components/wallet/SessionExpiredModal";
import { TransactionHistory } from "@/components/wallet/TransactionHistory";
import { TransactionToasts } from "@/components/wallet/TransactionToasts";
import { WalletConnectCard } from "@/components/wallet/WalletConnectCard";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { useAuth } from "@/hooks/useAuth";
import { useTxStatus } from "@/hooks/useTxStatus";
import { useWallet } from "@/hooks/useWallet";
import { createEmptyBalances, fetchWalletBalances } from "@/lib/wallet/balances";
import { walletConfig } from "@/lib/wallet/config";
import { submitWithdrawTransaction } from "@/lib/wallet/transactions";
import { isTokenNearExpiry } from "@/lib/wallet/tokenExpiry";
import { WalletAssetCode, WithdrawRequest } from "@/lib/wallet/types";

export function WalletDashboard() {
  const router = useRouter();
  const { refreshAccessToken, isRefreshing } = useAuth();
  const { session, isConnected, publicKey } = useWallet();
  const { history, appendHistory, clearHistory, trackTx } = useTxStatus();

  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  // Pending withdraw request — held while the session-expired modal is shown.
  const [pendingWithdraw, setPendingWithdraw] = useState<WithdrawRequest | null>(null);
  const [sessionExpiredVisible, setSessionExpiredVisible] = useState(false);

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

    // ── Token validity guard ──────────────────────────────────────────────
    // If the token is within 60 s of expiry, attempt a silent refresh first.
    // If the refresh fails, hold the request and show the session-expired
    // modal so the user can re-authenticate before the transaction proceeds.
    if (isTokenNearExpiry()) {
      try {
        await refreshAccessToken();
      } catch {
        // Refresh failed — store the request and surface the modal.
        setPendingWithdraw(request);
        setSessionExpiredVisible(true);
        return;
      }
    }

    await executeWithdraw(request);
  };

  // Separated so it can be called both from handleSubmitWithdraw and from
  // the modal's re-authenticate callback after a successful token refresh.
  const executeWithdraw = async (request: WithdrawRequest) => {
    if (!session) return;

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

  // Called by the modal when the user confirms re-authentication.
  const handleReauthenticate = async () => {
    try {
      await refreshAccessToken();
      setSessionExpiredVisible(false);
      if (pendingWithdraw) {
        setPendingWithdraw(null);
        await executeWithdraw(pendingWithdraw);
      }
    } catch {
      // Refresh still failing — redirect to login.
      setSessionExpiredVisible(false);
      setPendingWithdraw(null);
      router.push("/login?reason=session_expired");
    }
  };

  const handleDismissSessionExpired = () => {
    setSessionExpiredVisible(false);
    setPendingWithdraw(null);
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

      {sessionExpiredVisible && (
        <SessionExpiredModal
          onReauthenticate={handleReauthenticate}
          onDismiss={handleDismissSessionExpired}
          isRefreshing={isRefreshing}
        />
      )}
    </div>
  );
}
