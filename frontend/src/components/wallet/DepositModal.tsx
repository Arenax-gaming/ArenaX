"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WalletAssetCode } from "@/lib/wallet/types";

interface DepositModalProps {
  open: boolean;
  walletAddress: string;
  onClose: () => void;
  onRecordDeposit: (asset: WalletAssetCode, amount: number) => void;
}

const ASSETS: WalletAssetCode[] = ["XLM", "USDC", "ARENAX"];
const DEPOSIT_REQUEST_ENDPOINT = process.env.NEXT_PUBLIC_DEPOSIT_REQUEST_ENDPOINT;

export function DepositModal({
  open,
  walletAddress,
  onClose,
  onRecordDeposit,
}: DepositModalProps) {
  const [asset, setAsset] = useState<WalletAssetCode>("XLM");
  const [amount, setAmount] = useState("0");
  const [requestUrl, setRequestUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) {
    return null;
  }

  const handleRecordDeposit = () => {
    const parsedAmount = Number(amount);
    onRecordDeposit(asset, Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0);
    onClose();
  };

  const handleGenerateRequest = async () => {
    if (!DEPOSIT_REQUEST_ENDPOINT) {
      setError("Funding request endpoint is not configured for this environment.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(DEPOSIT_REQUEST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          asset,
          amount,
          destination: walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to generate funding request.");
      }

      const payload = (await response.json()) as { url?: string };
      setRequestUrl(payload.url ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate request.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Deposit</h2>
          <p className="text-sm text-muted-foreground">
            Send funds to your connected wallet address.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-2">
            <label htmlFor="deposit-asset" className="text-sm font-medium">
              Asset
            </label>
            <select
              id="deposit-asset"
              value={asset}
              onChange={(event) => setAsset(event.target.value as WalletAssetCode)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {ASSETS.map((assetCode) => (
                <option key={assetCode} value={assetCode}>
                  {assetCode}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="deposit-amount" className="text-sm font-medium">
              Expected Amount (optional)
            </label>
            <Input
              id="deposit-amount"
              type="number"
              min="0"
              step="0.0000001"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>

          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Deposit Address</p>
            <p className="break-all font-mono text-xs">{walletAddress}</p>
            <p className="text-xs text-muted-foreground">
              Memo is optional for self-custody wallets unless required by the sender.
            </p>
          </div>

          {requestUrl && (
            <div className="rounded-md border border-emerald-500/50 bg-emerald-100/60 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
              Funding request generated: {requestUrl}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void handleGenerateRequest();
            }}
            loading={loading}
          >
            Generate Request
          </Button>
          <Button onClick={handleRecordDeposit}>Record Pending Deposit</Button>
        </div>
      </div>
    </div>
  );
}
