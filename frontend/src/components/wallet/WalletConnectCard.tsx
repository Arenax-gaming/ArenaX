"use client";

import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { useWallet } from "@/hooks/useWallet";

interface WalletConnectCardProps {
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
}

const truncateAddress = (value: string) => {
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
};

export function WalletConnectCard({
  onOpenDeposit,
  onOpenWithdraw,
}: WalletConnectCardProps) {
  const {
    isConnected,
    publicKey,
    walletType,
    network,
    connectingWallet,
    error,
    connectFreighterWallet,
    connectAlbedoWallet,
    disconnectWallet,
  } = useWallet();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Connection</CardTitle>
        <CardDescription>
          Connect Freighter or Albedo to manage deposits and withdrawals.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConnected ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={() => {
                void connectFreighterWallet();
              }}
              loading={connectingWallet === "freighter"}
              className="sm:min-w-44"
            >
              Connect Freighter
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void connectAlbedoWallet();
              }}
              loading={connectingWallet === "albedo"}
              className="sm:min-w-44"
            >
              Connect Albedo
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Wallet</p>
                <p className="font-medium capitalize">{walletType}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Network</p>
                <p className="font-medium uppercase">{network}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Address</p>
                <p className="font-medium" title={publicKey ?? undefined}>
                  {publicKey ? truncateAddress(publicKey) : "-"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={onOpenDeposit}>Deposit</Button>
              <Button variant="outline" onClick={onOpenWithdraw}>
                Withdraw
              </Button>
              <Button variant="ghost" onClick={disconnectWallet}>
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
