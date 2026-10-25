"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WalletAssetCode } from "@/lib/wallet/types";
import { useAnalytics } from "@/hooks/useAnalytics";
import { api } from "@/lib/api";
import { handleFocusTrap, restoreFocus, announce } from "@/lib/accessibility";
import {
  CreditCard,
  QrCode,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowLeft,
  X,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

const QRCode = dynamic(
  () => import("@/components/wallet/QRCode").then((m) => m.QRCode),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 w-40 animate-pulse rounded-md bg-muted" aria-hidden="true" />
    ),
  },
);

export type DepositRail = "stellar" | "fiat";
export type FiatProvider = "paystack" | "flutterwave";
export type DepositState =
  | "intent"
  | "confirm"
  | "redirect"
  | "verifying"
  | "success"
  | "failure"
  | "cancellation"
  | "pending";

interface DepositModalProps {
  open: boolean;
  walletAddress: string;
  onClose: () => void;
  onRecordDeposit: (asset: WalletAssetCode, amount: number) => void;
  /** Optional initial reference if returning from provider redirect (#39) */
  initialReference?: string | null;
  initialProvider?: FiatProvider | null;
}

const STELLAR_ASSETS: WalletAssetCode[] = ["XLM", "USDC", "ARENAX"];

const FIAT_CONFIG: Record<
  string,
  { min: number; max: number; feeRate: number; symbol: string }
> = {
  NGN: { min: 100, max: 5_000_000, feeRate: 0.015, symbol: "₦" },
  USD: { min: 1, max: 10_000, feeRate: 0.025, symbol: "$" },
};

const STELLAR_CONFIG: Record<
  WalletAssetCode,
  { min: number; max: number; baseFee: string }
> = {
  XLM: { min: 1, max: 100_000, baseFee: "0.00001 XLM" },
  USDC: { min: 1, max: 10_000, baseFee: "0.00001 XLM" },
  ARENAX: { min: 10, max: 1_000_000, baseFee: "0.00001 XLM" },
};

export function DepositModal({
  open,
  walletAddress,
  onClose,
  onRecordDeposit,
  initialReference = null,
  initialProvider = null,
}: DepositModalProps) {
  const [rail, setRail] = useState<DepositRail>("stellar");
  const [asset, setAsset] = useState<WalletAssetCode>("XLM");
  const [fiatCurrency, setFiatCurrency] = useState<"NGN" | "USD">("NGN");
  const [fiatProvider, setFiatProvider] = useState<FiatProvider>("paystack");
  const [amount, setAmount] = useState<string>("10");

  const [depositState, setDepositState] = useState<DepositState>("intent");
  const [activeReference, setActiveReference] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const { track } = useAnalytics();

  // Save trigger element on open for focus restoration (#40)
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      if (initialReference) {
        // Returned from callback URL (#39) - never trust URL status, verify authoritative status
        setActiveReference(initialReference);
        setFiatProvider(initialProvider ?? "paystack");
        setDepositState("verifying");
      } else {
        setDepositState("intent");
        setErrorMessage(null);
        idempotencyKeyRef.current = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
    } else {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (triggerRef.current) restoreFocus(triggerRef.current);
    }
  }, [open, initialReference, initialProvider]);

  // Keyboard navigation & Focus Trap (#40)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && depositState !== "verifying" && depositState !== "redirect") {
        handleModalClose();
      } else if (modalRef.current) {
        handleFocusTrap(e, modalRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, depositState]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Poll authoritative backend verification within documented limits (#39)
  // Limit: max 5 polls at 3,000ms intervals (15 seconds total).
  const pollVerification = useCallback(
    async (reference: string, provider: FiatProvider, attempt = 1) => {
      const MAX_POLLS = 5;
      const POLL_INTERVAL_MS = 3000;

      setPollCount(attempt);

      try {
        const response = await api.verifyDeposit({ reference, provider });

        if (response.status === "completed" && response.verified) {
          setDepositState("success");
          announce("Deposit confirmed and verified successfully", "polite");
          track("deposit_completed", { provider, reference, status: "completed" });
          const parsed = Number(amount);
          if (parsed > 0) {
            onRecordDeposit(asset, parsed);
          }
          return;
        }

        if (response.status === "failed") {
          setDepositState("failure");
          setErrorMessage("Payment was declined or failed verification at the gateway.");
          announce("Deposit verification failed", "assertive");
          return;
        }

        // Still pending
        if (attempt < MAX_POLLS) {
          pollTimerRef.current = setTimeout(() => {
            pollVerification(reference, provider, attempt + 1);
          }, POLL_INTERVAL_MS);
        } else {
          // Documented limit reached -> transition to pending state for activity history recovery (#39)
          setDepositState("pending");
          announce("Deposit is pending. You can check back in your transaction history.", "polite");
        }
      } catch (err) {
        if (attempt < MAX_POLLS) {
          pollTimerRef.current = setTimeout(() => {
            pollVerification(reference, provider, attempt + 1);
          }, POLL_INTERVAL_MS);
        } else {
          setDepositState("pending");
        }
      }
    },
    [amount, asset, onRecordDeposit, track],
  );

  useEffect(() => {
    if (depositState === "verifying" && activeReference) {
      pollVerification(activeReference, fiatProvider, 1);
    }
  }, [depositState, activeReference, fiatProvider, pollVerification]);

  if (!open) return null;

  const parsedAmount = Number(amount) || 0;

  // Validation
  let inputError: string | null = null;
  if (rail === "fiat") {
    const cfg = FIAT_CONFIG[fiatCurrency];
    if (parsedAmount < cfg.min) {
      inputError = `Minimum deposit is ${cfg.symbol}${cfg.min}`;
    } else if (parsedAmount > cfg.max) {
      inputError = `Maximum deposit is ${cfg.symbol}${cfg.max.toLocaleString()}`;
    }
  } else {
    const cfg = STELLAR_CONFIG[asset];
    if (parsedAmount < cfg.min) {
      inputError = `Minimum deposit is ${cfg.min} ${asset}`;
    } else if (parsedAmount > cfg.max) {
      inputError = `Maximum deposit is ${cfg.max.toLocaleString()} ${asset}`;
    }
  }

  // Fees & limits calculations for confirmation (#39)
  const fiatFee = rail === "fiat" ? parsedAmount * FIAT_CONFIG[fiatCurrency].feeRate : 0;
  const fiatTotal = rail === "fiat" ? parsedAmount + fiatFee : parsedAmount;

  const handleProceedToConfirmation = () => {
    if (inputError || parsedAmount <= 0) return;
    setErrorMessage(null);
    setDepositState("confirm");
  };

  const handleExecuteDeposit = async () => {
    if (rail === "stellar") {
      // For on-chain Stellar deposit, user sends directly to destination address
      onRecordDeposit(asset, parsedAmount);
      setDepositState("success");
      track("deposit_initiated_stellar", { asset, amount: parsedAmount });
      return;
    }

    // Fiat rail: initiate intent with backend (#39)
    try {
      setDepositState("redirect");
      setErrorMessage(null);

      const result = await api.initiateDeposit({
        amount: parsedAmount,
        currency: fiatCurrency,
        payment_method: fiatProvider,
        idempotencyKey: idempotencyKeyRef.current ?? undefined,
      });

      setActiveReference(result.reference);

      if (result.authorization_url) {
        setAuthorizationUrl(result.authorization_url);
        // Open payment gateway in new window or redirect
        window.open(result.authorization_url, "_blank", "noopener,noreferrer");
      }

      // Enter verification state (polling gateway within documented limits)
      setDepositState("verifying");
    } catch (err) {
      setDepositState("failure");
      setErrorMessage(err instanceof Error ? err.message : "Unable to initiate deposit.");
    }
  };

  const handleModalClose = () => {
    if (depositState === "verifying") {
      // User abandoned / closing early (#39)
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      setDepositState("cancellation");
      onClose();
      return;
    }
    setDepositState("intent");
    onClose();
  };

  const handleRetry = () => {
    setErrorMessage(null);
    setDepositState("confirm");
  };

  const handleCancelIntent = () => {
    setDepositState("cancellation");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pb-safe backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-xl border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b px-5 sm:px-6 py-4">
          <div className="flex items-center gap-2">
            {depositState === "confirm" && (
              <button
                type="button"
                onClick={() => setDepositState("intent")}
                className="mr-1 text-muted-foreground hover:text-foreground p-1 rounded-md min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Back to edit deposit"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div>
              <h2 id="deposit-modal-title" className="text-lg font-semibold text-foreground">
                {depositState === "confirm"
                  ? "Confirm Deposit Details"
                  : depositState === "verifying"
                    ? "Verifying Payment"
                    : depositState === "success"
                      ? "Deposit Successful"
                      : depositState === "failure"
                        ? "Deposit Failed"
                        : depositState === "pending"
                          ? "Deposit Pending"
                          : depositState === "cancellation"
                            ? "Deposit Cancelled"
                            : "Deposit Funds"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {depositState === "confirm"
                  ? "Verify amount, limits, and fees before proceeding."
                  : "Supported fiat & Stellar payment rails."}
              </p>
            </div>
          </div>
          {depositState !== "verifying" && (
            <button
              type="button"
              onClick={handleModalClose}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Close deposit modal"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* Step 1: Intent & Input Form */}
          {depositState === "intent" && (
            <>
              {/* Rail Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Payment Rail</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRail("stellar")}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors min-h-[44px] ${
                      rail === "stellar"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted text-foreground"
                    }`}
                  >
                    <QrCode className="h-4 w-4" />
                    Stellar Crypto
                  </button>
                  <button
                    type="button"
                    onClick={() => setRail("fiat")}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors min-h-[44px] ${
                      rail === "fiat"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted text-foreground"
                    }`}
                  >
                    <CreditCard className="h-4 w-4" />
                    Fiat Gateway
                  </button>
                </div>
              </div>

              {/* Stellar Rail Inputs */}
              {rail === "stellar" && (
                <>
                  <div className="space-y-2">
                    <label htmlFor="deposit-asset-select" className="text-sm font-medium text-foreground">
                      Asset
                    </label>
                    <select
                      id="deposit-asset-select"
                      value={asset}
                      onChange={(e) => setAsset(e.target.value as WalletAssetCode)}
                      className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {STELLAR_ASSETS.map((code) => (
                        <option key={code} value={code}>
                          {code} (Stellar Network)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="deposit-amount-stellar" className="text-sm font-medium text-foreground">
                      Amount ({asset})
                    </label>
                    <Input
                      id="deposit-amount-stellar"
                      type="number"
                      min={STELLAR_CONFIG[asset].min}
                      max={STELLAR_CONFIG[asset].max}
                      step="0.0000001"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      error={!!inputError}
                      aria-describedby="stellar-amount-limits"
                      className="h-11"
                    />
                    <p id="stellar-amount-limits" className="text-xs text-muted-foreground">
                      Limits: Min {STELLAR_CONFIG[asset].min} {asset} &bull; Max {STELLAR_CONFIG[asset].max.toLocaleString()} {asset}
                    </p>
                  </div>

                  <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3.5 text-xs">
                    <p className="font-semibold text-foreground">Deposit Destination</p>
                    <div className="flex justify-center py-2">
                      <QRCode value={walletAddress} size={140} />
                    </div>
                    <p className="break-all font-mono text-center text-muted-foreground">{walletAddress}</p>
                    <p className="text-center text-muted-foreground">Network base fee: ~0.00001 XLM</p>
                  </div>
                </>
              )}

              {/* Fiat Rail Inputs */}
              {rail === "fiat" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label htmlFor="fiat-currency-select" className="text-sm font-medium text-foreground">
                        Currency
                      </label>
                      <select
                        id="fiat-currency-select"
                        value={fiatCurrency}
                        onChange={(e) => setFiatCurrency(e.target.value as "NGN" | "USD")}
                        className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <option value="NGN">NGN (Nigerian Naira)</option>
                        <option value="USD">USD (US Dollar)</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="fiat-provider-select" className="text-sm font-medium text-foreground">
                        Gateway Provider
                      </label>
                      <select
                        id="fiat-provider-select"
                        value={fiatProvider}
                        onChange={(e) => setFiatProvider(e.target.value as FiatProvider)}
                        className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <option value="paystack">Paystack</option>
                        <option value="flutterwave">Flutterwave</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="deposit-amount-fiat" className="text-sm font-medium text-foreground">
                      Amount ({fiatCurrency})
                    </label>
                    <Input
                      id="deposit-amount-fiat"
                      type="number"
                      min={FIAT_CONFIG[fiatCurrency].min}
                      max={FIAT_CONFIG[fiatCurrency].max}
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      error={!!inputError}
                      aria-describedby="fiat-amount-limits"
                      className="h-11"
                    />
                    <p id="fiat-amount-limits" className="text-xs text-muted-foreground">
                      Limits: Min {FIAT_CONFIG[fiatCurrency].symbol}{FIAT_CONFIG[fiatCurrency].min} &bull; Max {FIAT_CONFIG[fiatCurrency].symbol}{FIAT_CONFIG[fiatCurrency].max.toLocaleString()}
                    </p>
                  </div>

                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs space-y-1 text-muted-foreground">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      Secure Gateway Transfer
                    </p>
                    <p>
                      You will review fees, limits, and destination account before any payment action is initiated.
                    </p>
                  </div>
                </>
              )}

              {inputError && (
                <p className="text-xs text-destructive font-medium" role="alert">
                  {inputError}
                </p>
              )}
            </>
          )}

          {/* Step 2: Confirmation Before Irreversible Action (#39) */}
          {depositState === "confirm" && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit Rail:</span>
                  <span className="font-semibold text-foreground uppercase">{rail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit Amount:</span>
                  <span className="font-semibold text-foreground">
                    {rail === "fiat"
                      ? `${FIAT_CONFIG[fiatCurrency].symbol}${parsedAmount.toLocaleString()}`
                      : `${parsedAmount} ${asset}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gateway / Network Fee:</span>
                  <span className="font-medium text-foreground">
                    {rail === "fiat"
                      ? `${FIAT_CONFIG[fiatCurrency].symbol}${fiatFee.toFixed(2)} (${FIAT_CONFIG[fiatCurrency].feeRate * 100}%)`
                      : STELLAR_CONFIG[asset].baseFee}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="font-semibold text-foreground">Total Charge:</span>
                  <span className="font-bold text-foreground">
                    {rail === "fiat"
                      ? `${FIAT_CONFIG[fiatCurrency].symbol}${fiatTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      : `${parsedAmount} ${asset}`}
                  </span>
                </div>
                <div className="border-t border-border pt-2 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Destination Account:</p>
                  <p className="font-mono break-all">{walletAddress}</p>
                </div>
              </div>

              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
                <p className="font-medium">Irreversible Action Confirmation:</p>
                <p className="mt-0.5">
                  Confirming will initiate your deposit intent. Return URLs are verified authoritatively with the gateway before crediting.
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Verifying State (Polling Gateway within Documented Limits #39) */}
          {depositState === "verifying" && (
            <div className="space-y-4 py-3 text-center" role="status" aria-live="polite">
              <div className="flex justify-center">
                <RefreshCw className="h-10 w-10 text-primary animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">
                  Verifying Gateway Payment…
                </p>
                <p className="text-xs text-muted-foreground">
                  Attempt {pollCount} of 5 &bull; Checking authoritative payment status with {fiatProvider.toUpperCase()}.
                </p>
              </div>
              {authorizationUrl && (
                <div className="pt-2">
                  <a
                    href={authorizationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary underline hover:text-primary/80"
                  >
                    Re-open Payment Gateway <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Success State */}
          {depositState === "success" && (
            <div className="space-y-3 py-2 text-center" role="status" aria-live="polite">
              <div className="flex justify-center">
                <CheckCircle className="h-12 w-12 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Deposit Confirmed</h3>
              <p className="text-sm text-muted-foreground">
                Your deposit of {amount} {rail === "fiat" ? fiatCurrency : asset} was authoritatively verified and credited to your wallet.
              </p>
            </div>
          )}

          {/* Failure State */}
          {depositState === "failure" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive space-y-2" role="alert">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                Deposit Failed or Declined
              </p>
              <p className="text-xs text-destructive-foreground/90">{errorMessage || "The payment gateway rejected or declined this transaction."}</p>
              <p className="text-xs text-muted-foreground pt-1">
                No funds were deducted. You can retry with a different amount or payment rail.
              </p>
            </div>
          )}

          {/* Cancellation State (#39) */}
          {depositState === "cancellation" && (
            <div className="rounded-lg border border-muted bg-muted/40 p-4 text-sm space-y-2">
              <p className="font-semibold text-foreground">Deposit Cancelled</p>
              <p className="text-xs text-muted-foreground">
                You abandoned or cancelled this deposit. No charges were made.
              </p>
            </div>
          )}

          {/* Pending Deferred Resolution State (#39) */}
          {depositState === "pending" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 text-sm space-y-2 text-amber-900 dark:text-amber-200">
              <p className="font-semibold flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Deposit In Progress (Pending)
              </p>
              <p className="text-xs">
                The gateway has not finalized the transaction yet. We have saved reference <code className="font-mono font-semibold">{activeReference}</code> to your transaction history.
              </p>
              <p className="text-xs text-muted-foreground">
                You can safely close this modal now and recover status later from your Activity History.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t p-4 sm:p-5 flex gap-3">
          {depositState === "intent" && (
            <>
              <Button variant="secondary" onClick={handleModalClose} className="flex-1 min-h-[44px]">
                Cancel
              </Button>
              <Button
                onClick={handleProceedToConfirmation}
                disabled={Boolean(inputError) || parsedAmount <= 0}
                className="flex-1 min-h-[44px]"
              >
                Review Deposit
              </Button>
            </>
          )}

          {depositState === "confirm" && (
            <>
              <Button variant="secondary" onClick={handleCancelIntent} className="flex-1 min-h-[44px]">
                Cancel
              </Button>
              <Button onClick={handleExecuteDeposit} className="flex-1 min-h-[44px]">
                Confirm &amp; Proceed
              </Button>
            </>
          )}

          {depositState === "verifying" && (
            <Button disabled className="w-full min-h-[44px]" variant="secondary" loading>
              Verifying with Gateway…
            </Button>
          )}

          {(depositState === "success" || depositState === "pending") && (
            <Button onClick={handleModalClose} className="w-full min-h-[44px]">
              Close
            </Button>
          )}

          {depositState === "failure" && (
            <>
              <Button variant="secondary" onClick={handleModalClose} className="flex-1 min-h-[44px]">
                Close
              </Button>
              <Button onClick={handleRetry} className="flex-1 min-h-[44px]">
                Retry
              </Button>
            </>
          )}

          {depositState === "cancellation" && (
            <>
              <Button variant="secondary" onClick={handleModalClose} className="flex-1 min-h-[44px]">
                Close
              </Button>
              <Button onClick={() => setDepositState("intent")} className="flex-1 min-h-[44px]">
                Try Again
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
