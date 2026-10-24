"use client";

import { useEffect, useState, useRef } from "react";
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
import { handleFocusTrap, restoreFocus, announce } from "@/lib/accessibility";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  ShieldAlert,
  X,
  ExternalLink,
} from "lucide-react";

interface WithdrawModalProps {
  open: boolean;
  balances: WalletBalances;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: WithdrawRequest) => Promise<void>;
}

type WithdrawStep = "intent" | "confirm" | "submitting" | "success" | "failure" | "cancelled";

const ASSETS: WalletAssetCode[] = ["XLM", "USDC", "ARENAX"];

const ESTIMATED_NETWORK_FEE: Record<WalletAssetCode, string> = {
  XLM: "0.00001 XLM",
  USDC: "0.00001 XLM",
  ARENAX: "0.00001 XLM",
};

export function WithdrawModal({
  open,
  balances,
  isSubmitting,
  onClose,
  onSubmit,
}: WithdrawModalProps) {
  const [step, setStep] = useState<WithdrawStep>("intent");
  const [confirmedPayload, setConfirmedPayload] = useState<WithdrawRequest | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

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
  const selectedBalance = balances[watchedAsset] ?? {
    available: 0,
    locked: 0,
    total: 0,
    hasTrustline: false,
  };

  // Focus preservation and reset on open/close (#40)
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      setStep("intent");
      setErrorMessage(null);
    } else {
      form.reset();
      if (triggerRef.current) restoreFocus(triggerRef.current);
    }
  }, [open, form]);

  // Keyboard accessibility (#40)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "submitting") {
        handleClose();
      } else if (modalRef.current) {
        handleFocusTrap(e, modalRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, step]);

  if (!open) return null;

  // Step 1: Validate and prepare confirmation before irreversible action (#39)
  const handleReviewWithdrawal = async (data: WithdrawFormData) => {
    const parsedAmount = Number(data.amount);

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

    if (parsedAmount <= 0) {
      form.setError("amount", { message: "Withdrawal amount must be greater than zero." });
      return;
    }

    const payload: WithdrawRequest = {
      asset: data.asset,
      amount: parsedAmount,
      destination: data.destination.trim(),
      memo: data.memo?.trim() || undefined,
    };

    setConfirmedPayload(payload);
    setStep("confirm");
  };

  // Step 2: Irreversible execution after explicit confirmation (#39)
  const handleExecuteConfirmedWithdrawal = async () => {
    if (!confirmedPayload) return;

    setStep("submitting");
    setErrorMessage(null);

    try {
      await onSubmit(confirmedPayload);
      setStep("success");
      announce("Withdrawal transaction signed and submitted successfully", "polite");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Withdrawal failed.";
      setErrorMessage(msg);
      setStep("failure");
      announce(`Withdrawal failed: ${msg}`, "assertive");
    }
  };

  const handleClose = () => {
    if (step === "submitting" || isSubmitting) return;
    setStep("intent");
    onClose();
  };

  const handleCancelConfirmation = () => {
    setStep("intent");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pb-safe backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-xl border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 sm:px-6 py-4">
          <div className="flex items-center gap-2">
            {step === "confirm" && (
              <button
                type="button"
                onClick={handleCancelConfirmation}
                className="mr-1 text-muted-foreground hover:text-foreground p-1 rounded-md min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Back to edit withdrawal"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div>
              <h2 id="withdraw-modal-title" className="text-lg font-semibold text-foreground">
                {step === "confirm"
                  ? "Confirm Withdrawal Details"
                  : step === "submitting"
                    ? "Signing & Submitting Withdrawal"
                    : step === "success"
                      ? "Withdrawal Submitted"
                      : step === "failure"
                        ? "Withdrawal Failed"
                        : "Withdraw Funds"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {step === "confirm"
                  ? "Carefully verify amount, network fee, and destination address."
                  : "Send assets from your connected Stellar wallet."}
              </p>
            </div>
          </div>
          {step !== "submitting" && (
            <button
              type="button"
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Close withdraw modal"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* Step 1: Input Form */}
          {step === "intent" && (
            <Form {...form}>
              <form
                id="withdraw-form"
                onSubmit={form.handleSubmit(handleReviewWithdrawal)}
                noValidate
                className="space-y-4"
              >
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
                          id="withdraw-asset-select"
                          className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                      <div className="flex justify-between items-center">
                        <FormLabel>Amount</FormLabel>
                        <span className="text-xs text-muted-foreground">
                          Available: {selectedBalance.available.toLocaleString()} {watchedAsset}
                        </span>
                      </div>
                      <FormControl>
                        <Input
                          {...field}
                          id="withdraw-amount-input"
                          type="number"
                          min="0.0000001"
                          max={selectedBalance.available}
                          step="0.0000001"
                          placeholder="0.0"
                          error={!!form.formState.errors.amount}
                          className="h-11"
                        />
                      </FormControl>
                      <FormDescription>
                        Estimated base network fee: {ESTIMATED_NETWORK_FEE[watchedAsset]}
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
                          id="withdraw-destination-input"
                          placeholder="G..."
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck="false"
                          error={!!form.formState.errors.destination}
                          className="h-11 font-mono text-xs sm:text-sm"
                        />
                      </FormControl>
                      <FormDescription>Valid Stellar public key (starts with G)</FormDescription>
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
                      <FormLabel>Memo (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id="withdraw-memo-input"
                          placeholder="Required by some exchanges"
                          maxLength={28}
                          className="h-11"
                        />
                      </FormControl>
                      <FormDescription>Max 28 characters text memo</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          )}

          {/* Step 2: Explicit Confirmation Before Irreversible Action (#39) */}
          {step === "confirm" && confirmedPayload && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Withdrawal Asset:</span>
                  <span className="font-semibold text-foreground">{confirmedPayload.asset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Withdrawal Amount:</span>
                  <span className="font-semibold text-foreground">
                    {confirmedPayload.amount} {confirmedPayload.asset}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network Fee:</span>
                  <span className="font-medium text-foreground">
                    {ESTIMATED_NETWORK_FEE[confirmedPayload.asset]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining Balance:</span>
                  <span className="font-medium text-foreground">
                    {(selectedBalance.available - confirmedPayload.amount).toLocaleString()}{" "}
                    {confirmedPayload.asset}
                  </span>
                </div>
                <div className="border-t border-border pt-2 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Destination Public Key:</p>
                  <p className="font-mono break-all text-foreground">{confirmedPayload.destination}</p>
                </div>
                {confirmedPayload.memo && (
                  <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Memo:</p>
                    <p className="font-mono">{confirmedPayload.memo}</p>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4" />
                  Irreversible Transaction Warning
                </p>
                <p className="text-muted-foreground">
                  Stellar blockchain transfers cannot be cancelled or reversed once signed. Please verify that the destination address and memo are correct.
                </p>
              </div>
            </div>
          )}

          {/* Submitting / Signing State */}
          {step === "submitting" && (
            <div className="space-y-4 py-4 text-center" role="status" aria-live="polite">
              <div className="flex justify-center">
                <Clock className="h-10 w-10 text-primary animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">
                  Waiting for Wallet Signature…
                </p>
                <p className="text-xs text-muted-foreground">
                  Please approve the transaction in your connected Stellar wallet.
                </p>
              </div>
            </div>
          )}

          {/* Success State */}
          {step === "success" && (
            <div className="space-y-3 py-3 text-center" role="status" aria-live="polite">
              <div className="flex justify-center">
                <CheckCircle className="h-12 w-12 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Withdrawal Submitted</h3>
              <p className="text-sm text-muted-foreground">
                Your withdrawal of {confirmedPayload?.amount} {confirmedPayload?.asset} has been signed and broadcast to the network.
              </p>
            </div>
          )}

          {/* Failure State */}
          {step === "failure" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive space-y-2" role="alert">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                Withdrawal Failed
              </p>
              <p className="text-xs text-destructive-foreground/90">{errorMessage || "Unable to complete withdrawal transaction."}</p>
              <p className="text-xs text-muted-foreground pt-1">
                No funds were deducted. You can verify your balance and retry.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 sm:p-5 flex gap-3">
          {step === "intent" && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                className="flex-1 min-h-[44px]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="withdraw-form"
                disabled={selectedBalance.available <= 0}
                className="flex-1 min-h-[44px]"
              >
                Review Withdrawal
              </Button>
            </>
          )}

          {step === "confirm" && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancelConfirmation}
                className="flex-1 min-h-[44px]"
              >
                Edit
              </Button>
              <Button
                type="button"
                onClick={handleExecuteConfirmedWithdrawal}
                className="flex-1 min-h-[44px]"
              >
                Confirm &amp; Sign
              </Button>
            </>
          )}

          {step === "submitting" && (
            <Button disabled className="w-full min-h-[44px]" variant="secondary" loading>
              Signing Withdrawal…
            </Button>
          )}

          {step === "success" && (
            <Button type="button" onClick={handleClose} className="w-full min-h-[44px]">
              Close
            </Button>
          )}

          {step === "failure" && (
            <>
              <Button type="button" variant="secondary" onClick={handleClose} className="flex-1 min-h-[44px]">
                Close
              </Button>
              <Button type="button" onClick={() => setStep("confirm")} className="flex-1 min-h-[44px]">
                Retry
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
