import React from "react";
import { PrizeDistribution } from "@/types/bracket";
import { Card, CardContent } from "@/components/ui/Card";
import { Trophy, Medal } from "lucide-react";

interface PrizePoolProps {
  prizePool: number;
  distribution: PrizeDistribution[];
}

const positionIcons = [
  <Trophy key={1} className="h-5 w-5 text-amber-400" />,
  <Medal key={2} className="h-5 w-5 text-slate-400" />,
  <Medal key={3} className="h-5 w-5 text-orange-400" />,
];

export function PrizePool({ prizePool, distribution }: PrizePoolProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold text-foreground">Prize Distribution</h3>
        </div>

        <div className="mb-4 rounded-lg bg-gradient-to-r from-amber-500/10 to-yellow-500/10 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Total Prize Pool</p>
          <p className="mt-1 text-3xl font-black text-foreground">
            ${prizePool.toLocaleString()}
          </p>
        </div>

        <div className="space-y-3">
          {distribution.map((tier, idx) => (
            <div
              key={tier.position}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                {positionIcons[idx] ?? (
                  <span className="flex h-5 w-5 items-center justify-center text-xs font-bold text-muted-foreground">
                    {tier.position}
                  </span>
                )}
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {tier.label ?? `${tier.position}${getOrdinal(tier.position)} Place`}
                  </p>
                  <p className="text-xs text-muted-foreground">{tier.percentage}% of pool</p>
                </div>
              </div>
              <p className={`text-sm font-bold ${tier.highlight ?? "text-foreground"}`}>
                ${tier.amount?.toLocaleString() ?? Math.round(prizePool * tier.percentage / 100).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
