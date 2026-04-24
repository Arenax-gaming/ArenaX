"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const gameModes = [
  { label: "Quick Match", description: "Jump into a ranked 1v1", href: "/tournaments", icon: "⚡", color: "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20" },
  { label: "Tournament", description: "Browse open tournaments", href: "/tournaments", icon: "🏆", color: "bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/20" },
  { label: "Practice", description: "Unranked casual match", href: "/tournaments", icon: "🎮", color: "bg-green-500/10 hover:bg-green-500/20 border-green-500/20" },
];

export function QuickPlay() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Quick Play</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {gameModes.map((mode) => (
          <Link key={mode.label} href={mode.href}>
            <div className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode.color}`}>
              <span className="text-2xl">{mode.icon}</span>
              <div>
                <p className="text-sm font-semibold">{mode.label}</p>
                <p className="text-xs text-muted-foreground">{mode.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
