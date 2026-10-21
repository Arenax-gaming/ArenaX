"use client";

import { Coins } from "lucide-react";
import {
  useReputationBalance,
  useReputationHistory,
} from "@/hooks/useReputation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

interface ReputationBalanceProps {
  userId: string;
  publicKey?: string;
}

/** Inline Reputation Token balance, e.g. for leaderboard rows. */
export function ReputationBalanceValue({ publicKey }: { publicKey?: string }) {
  if (!publicKey) return <span className="text-muted-foreground">—</span>;
  return <LinkedBalance publicKey={publicKey} />;
}

function LinkedBalance({ publicKey }: { publicKey: string }) {
  const { data, isLoading } = useReputationBalance(publicKey);
  if (isLoading) return <span className="text-muted-foreground">…</span>;
  return <span>{(data ?? 0).toLocaleString()}</span>;
}

/** Profile card: on-chain balance plus a breakdown of reputation changes. */
export function ReputationBalance({ userId, publicKey }: ReputationBalanceProps) {
  const { data: history } = useReputationHistory(userId, 1, 10);
  const events = history?.data ?? [];

  const breakdown = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + e.skill_delta + e.fair_play_delta;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" /> Reputation Tokens
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold">
            <ReputationBalanceValue publicKey={publicKey} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {publicKey ?? "No Stellar account linked"}
          </p>
        </div>

        {Object.keys(breakdown).length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Breakdown</h4>
            <ul className="space-y-1 text-sm">
              {Object.entries(breakdown).map(([type, delta]) => (
                <li key={type} className="flex justify-between">
                  <span className="capitalize">{type.replace(/_/g, " ")}</span>
                  <span className={delta < 0 ? "text-red-500" : "text-green-500"}>
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {events.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Recent history</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span>{new Date(e.created_at).toLocaleDateString()}</span>
                  <span className="capitalize">{e.event_type.replace(/_/g, " ")}</span>
                  <span>{e.skill_delta + e.fair_play_delta}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
