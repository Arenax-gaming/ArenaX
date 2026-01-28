import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function WalletPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="text-muted-foreground">
          Track balances and payouts connected to your ArenaX account.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Wallet overview</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Wallet information will appear once payouts are enabled.
        </CardContent>
      </Card>
    </div>
  );
}
