import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Manage your ArenaX identity and settings.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile overview</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Profile details will appear once your account is connected.
        </CardContent>
      </Card>
    </div>
  );
}
