import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function TournamentsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tournaments</h1>
        <p className="text-muted-foreground">
          Browse upcoming and live competitions.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Tournament listings will appear here once they are available.
        </CardContent>
      </Card>
    </div>
  );
}
