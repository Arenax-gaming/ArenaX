"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BalanceCards } from "@/components/wallet/BalanceCards";
import { DepositModal, FiatProvider } from "@/components/wallet/DepositModal";
import { TransactionHistory } from "@/components/wallet/TransactionHistory";
import { TransactionToasts } from "@/components/wallet/TransactionToasts";
import { WalletConnectCard } from "@/components/wallet/WalletConnectCard";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { useTxStatus } from "@/hooks/useTxStatus";
import { useWallet } from "@/hooks/useWallet";
import { useTokenExpiry, SessionExpiredError } from "@/hooks/useTokenExpiry";
import { SessionExpiredModal } from "@/components/wallet/SessionExpiredModal";
import { createEmptyBalances, fetchWalletBalances } from "@/lib/wallet/balances";
import { walletConfig } from "@/lib/wallet/config";
import { submitWithdrawTransaction } from "@/lib/wallet/transactions";
import { WalletAssetCode, WithdrawRequest } from "@/lib/wallet/types";

export function WalletDashboard() {
  const { session, isConnected, publicKey } = useWallet();
  const { history, appendHistory, clearHistory, trackTx } = useTxStatus();

  const { ensureValidToken } = useTokenExpiry();

  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [isSessionExpiredOpen, setIsSessionExpiredOpen] = useState(false);

  // Return URL validation state (#39)
  const [initialReference, setInitialReference] = useState<string | null>(null);
  const [initialProvider, setInitialProvider] = useState<FiatProvider | null>(null);

  // Inspect return URLs on load — never treat return URL as proof of payment (#39)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const ref = params.get("reference") || params.get("tx_ref");
    const prov = (params.get("provider") as FiatProvider) || "paystack";

    if (ref) {
      setInitialReference(ref);
      setInitialProvider(prov);
      setIsDepositOpen(true);

      // Clean the query parameter without reload so refresh doesn't replay
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

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

  const handleRecordDeposit = async (asset: WalletAssetCode, amount: number) => {
    try {
      await ensureValidToken();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setIsSessionExpiredOpen(true);
        return;
      }
      throw err;
    }
    appendHistory({
      direction: "deposit",
      asset,
      amount,
      status: "pending",
      kind: "classic",
    });
    balancesQuery.refetch();
  };

  const handleVerifyHistoryItem = (reference: string, provider?: string) => {
    setInitialReference(reference);
    setInitialProvider((provider as FiatProvider) ?? "paystack");
    setIsDepositOpen(true);
  };

  const handleSubmitWithdraw = async (request: WithdrawRequest) => {
    if (!session) {
      throw new Error("Connect a wallet before withdrawing.");
    }

    try {
      await ensureValidToken();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setIsSessionExpiredOpen(true);
        return;
      }
      throw err;
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

  const activeWalletAddress = publicKey || "G_ARENAX_USER_WALLET";

  return (
    <div className="space-y-6 pb-28 sm:pb-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Connect your Stellar wallet, track balances, deposit with fiat or crypto, and review transaction status.
        </p>
      </div>

      <WalletConnectCard
        onOpenDeposit={() => {
          setInitialReference(null);
          setInitialProvider(null);
          setIsDepositOpen(true);
        }}
        onOpenWithdraw={() => setIsWithdrawOpen(true)}
      />

      {balancesQuery.error && isConnected && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
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

      <TransactionHistory
        items={history}
        onClear={clearHistory}
        onVerifyItem={handleVerifyHistoryItem}
      />

      {/* Deposit Modal (Fiat & Stellar rails) */}
      <DepositModal
        open={isDepositOpen}
        walletAddress={activeWalletAddress}
        onClose={() => {
          setIsDepositOpen(false);
          setInitialReference(null);
          setInitialProvider(null);
        }}
        onRecordDeposit={handleRecordDeposit}
        initialReference={initialReference}
        initialProvider={initialProvider}
      />

      {/* Withdraw Modal with explicit confirmation before irreversible action (#39) */}
      {isConnected && (
        <WithdrawModal
          open={isWithdrawOpen}
          balances={balances}
          isSubmitting={withdrawSubmitting}
          onClose={() => setIsWithdrawOpen(false)}
          onSubmit={handleSubmitWithdraw}
        />
      )}

      <TransactionToasts />

      <SessionExpiredModal
        open={isSessionExpiredOpen}
        onClose={() => setIsSessionExpiredOpen(false)}
      />
    </div>
  );
}
