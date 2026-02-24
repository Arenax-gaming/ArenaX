"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isValidStellarAddress } from "@/lib/wallet/transactions";
import { WalletAssetCode, WalletBalances, WithdrawRequest } from "@/lib/wallet/types";

interface WithdrawModalProps {
  open: boolean;
  balances: WalletBalances;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: WithdrawRequest) => Promise<void>;
}

const ASSETS: WalletAssetCode[] = ["XLM", "USDC", "ARENAX"];

interface ValidationErrors {
  asset?: string;
  amount?: string;
  destination?: string;
}

export function WithdrawModal({
  open,
  balances,
  isSubmitting,
  onClose,
  onSubmit,
}: WithdrawModalProps) {
  const [asset, setAsset] = useState<WalletAssetCode>("XLM");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setDestination("");
      setMemo("");
      setErrors({});
      setSubmitError(null);
      setAsset("XLM");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const validate = (): boolean => {
    const nextErrors: ValidationErrors = {};
    const selectedBalance = balances[asset];
    const parsedAmount = Number(amount);

    if (!selectedBalance.hasTrustline && asset !== "XLM") {
      nextErrors.asset = `Add ${asset} trustline in your wallet before withdrawing.`;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      nextErrors.amount = "Enter a valid amount greater than 0.";
    } else if (parsedAmount > selectedBalance.available) {
      nextErrors.amount = "Amount exceeds available balance.";
    }

    if (!destination.trim()) {
      nextErrors.destination = "Destination address is required.";
    } else if (!isValidStellarAddress(destination)) {
      nextErrors.destination = "Destination must be a valid Stellar public key.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

    setSubmitError(null);

    try {
      await onSubmit({
        asset,
        amount: Number(amount),
        destination: destination.trim(),
        memo: memo.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Withdraw failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Withdraw</h2>
          <p className="text-sm text-muted-foreground">
            Send assets from your connected wallet.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-2">
            <label htmlFor="withdraw-asset" className="text-sm font-medium">
              Asset
            </label>
            <select
              id="withdraw-asset"
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
            {errors.asset && (
              <p className="text-xs text-destructive" role="alert">
                {errors.asset}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="withdraw-amount" className="text-sm font-medium">
              Amount
            </label>
            <Input
              id="withdraw-amount"
              type="number"
              min="0"
              step="0.0000001"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              error={Boolean(errors.amount)}
            />
            <p className="text-xs text-muted-foreground">
              Available: {balances[asset].available.toLocaleString("en-US", { maximumFractionDigits: 7 })}
            </p>
            {errors.amount && (
              <p className="text-xs text-destructive" role="alert">
                {errors.amount}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="withdraw-destination" className="text-sm font-medium">
              Destination Address
            </label>
            <Input
              id="withdraw-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="G..."
              error={Boolean(errors.destination)}
            />
            {errors.destination && (
              <p className="text-xs text-destructive" role="alert">
                {errors.destination}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="withdraw-memo" className="text-sm font-medium">
              Memo (optional)
            </label>
            <Input
              id="withdraw-memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              maxLength={28}
              placeholder="Optional memo"
            />
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} loading={isSubmitting}>
            Submit Withdrawal
          </Button>
        </div>
      </div>
    </div>
  );
}
