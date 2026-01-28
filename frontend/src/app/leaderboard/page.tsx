import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <p className="text-muted-foreground">
          Track top performers across ArenaX.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Standings update soon</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Leaderboard data will populate after the next tournament cycle.
        </CardContent>
      </Card>
    </div>
  );
}
