import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { Trophy } from "lucide-react";

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
        <CardContent className="p-0">
          <EmptyState
            icon={Trophy}
            title="Leaderboard coming soon"
            description="Standings will be available after the next tournament cycle. Compete in tournaments to climb the ranks!"
            size="lg"
          />
        </CardContent>
      </Card>
    </div>
  );
}
