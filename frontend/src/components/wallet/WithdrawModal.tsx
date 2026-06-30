"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { WalletAssetCode, WalletBalances, WithdrawRequest } from "@/lib/wallet/types";
import { withdrawSchema, type WithdrawFormData } from "@/lib/validations/wallet";

interface WithdrawModalProps {
  open: boolean;
  balances: WalletBalances;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: WithdrawRequest) => Promise<void>;
}

const ASSETS: WalletAssetCode[] = ["XLM", "USDC", "ARENAX"];

export function WithdrawModal({
  open,
  balances,
  isSubmitting,
  onClose,
  onSubmit,
}: WithdrawModalProps) {
  const form = useForm<WithdrawFormData>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: {
      asset: "XLM",
      amount: "",
      destination: "",
      memo: "",
    },
  });

  const watchedAsset = form.watch("asset") as WalletAssetCode;

  // Reset form when modal closes
  useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  if (!open) return null;

  const selectedBalance = balances[watchedAsset];

  const handleSubmit = async (data: WithdrawFormData) => {
    const parsedAmount = Number(data.amount);

    // Runtime balance checks (can't be in Zod since balances aren't in the schema)
    if (!selectedBalance.hasTrustline && data.asset !== "XLM") {
      form.setError("asset", {
        message: `Add ${data.asset} trustline in your wallet before withdrawing.`,
      });
      return;
    }

    if (parsedAmount > selectedBalance.available) {
      form.setError("amount", { message: "Amount exceeds available balance." });
      return;
    }

    try {
      await onSubmit({
        asset: data.asset,
        amount: parsedAmount,
        destination: data.destination.trim(),
        memo: data.memo?.trim() || undefined,
      });
      onClose();
    } catch (err) {
      form.setError("root", {
        message: err instanceof Error ? err.message : "Withdraw failed.",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
    >
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg">
        <div className="border-b px-6 py-4">
          <h2 id="withdraw-modal-title" className="text-lg font-semibold">
            Withdraw
          </h2>
          <p className="text-sm text-muted-foreground">
            Send assets from your connected wallet.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} noValidate>
            <div className="space-y-4 px-6 py-5">
              {/* Asset */}
              <FormField
                control={form.control}
                name="asset"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {ASSETS.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="0"
                        step="0.0000001"
                        error={!!form.formState.errors.amount}
                      />
                    </FormControl>
                    <FormDescription>
                      Available:{" "}
                      {selectedBalance.available.toLocaleString("en-US", {
                        maximumFractionDigits: 7,
                      })}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Destination */}
              <FormField
                control={form.control}
                name="destination"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination Address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="G..."
                        error={!!form.formState.errors.destination}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Memo */}
              <FormField
                control={form.control}
                name="memo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Memo (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={28} placeholder="Optional memo" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Root submission error */}
              {form.formState.errors.root && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {form.formState.errors.root.message}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t px-6 py-4">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Submit Withdrawal
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
