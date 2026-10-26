"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { StellarTransactionList } from "@/components/stellar/StellarTransactionList";
import { leaderboardWsUrl } from "@/lib/communityLeaderboard";
import {
  fetchTournamentTransactions,
  formatStroops,
  isPrizeDistribution,
  type StellarTransactionRecord,
} from "@/lib/stellarExplorer";

interface StellarPrizePoolCardProps {
  tournamentId: string;
}

/**
 * Live Stellar prize pool balance for a tournament: entry fee escrows minus
 * prize distributions, refreshed whenever the realtime socket reports a
 * change for this tournament.
 */
export function StellarPrizePoolCard({
  tournamentId,
}: StellarPrizePoolCardProps) {
  const [transactions, setTransactions] = useState<StellarTransactionRecord[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTransactions(await fetchTournamentTransactions(tournamentId));
      setError(null);
    } catch {
      setError("Unable to load Stellar prize pool.");
    }
  }, [tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const url = leaderboardWsUrl();
    if (!url || typeof WebSocket === "undefined") return;

    const socket = new WebSocket(url);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
        const payload = message?.data ?? message;
        if (
          payload?.tournament_id === tournamentId ||
          payload?.tournamentId === tournamentId
        ) {
          load();
        }
      } catch {
        // Ignore non-JSON frames.
      }
    };

    return () => socket.close();
  }, [load, tournamentId]);

  const balance = useMemo(
    () =>
      transactions.reduce(
        (total, tx) =>
          total + (isPrizeDistribution(tx) ? -tx.amount : tx.amount),
        0,
      ),
    [transactions],
  );

  return (
    <div className="rounded-[32px] border border-border bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Wallet className="h-4 w-4 text-cyan-600" />
        Stellar Prize Pool
      </div>
      <p
        className="mt-3 text-2xl font-semibold text-foreground"
        aria-live="polite"
      >
        {formatStroops(balance)}
      </p>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      <div className="mt-5">
        <StellarTransactionList transactions={transactions} />
      </div>
    </div>
  );
}
