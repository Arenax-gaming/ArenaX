"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle, Loader2 } from "lucide-react";
import { Tournament } from "@/types/tournament";
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
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";
import {
  tournamentRegistrationSchema,
  type TournamentRegistrationFormData,
} from "@/lib/validations/tournament";
import { useFormAnalytics } from "@/hooks/useFormAnalytics";
import { useWallet } from "@/hooks/useWallet";
import { fetchWalletBalances } from "@/lib/wallet";

export type RegistrationPaymentMethod = "fiat" | "arenax";

const PAYMENT_METHOD_STORAGE_KEY = "arenax.registration.paymentMethod";

/** Estimated card processing fee for fiat payments (2.9% + $0.30). */
const FIAT_FEE_RATE = 0.029;
const FIAT_FEE_FIXED = 0.3;
/** Stellar base network fee (100 stroops) for ArenaX token payments. */
const TOKEN_NETWORK_FEE_XLM = 0.00001;

export function estimateRegistrationFee(
  entryFee: number,
  method: RegistrationPaymentMethod,
): { fee: number; total: number } {
  if (entryFee <= 0) return { fee: 0, total: 0 };
  const fee =
    method === "fiat"
      ? Math.round((entryFee * FIAT_FEE_RATE + FIAT_FEE_FIXED) * 100) / 100
      : 0;
  return { fee, total: entryFee + fee };
}

function readStoredPaymentMethod(): RegistrationPaymentMethod {
  try {
    const value = localStorage.getItem(PAYMENT_METHOD_STORAGE_KEY);
    return value === "arenax" ? "arenax" : "fiat";
  } catch {
    return "fiat";
  }
}

interface RegistrationFormProps {
  tournament: Tournament;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function RegistrationForm({
  tournament,
  onSuccess,
  onCancel,
}: RegistrationFormProps) {
  const { notify } = useNotifications();
  const analytics = useFormAnalytics(`tournament-registration-${tournament.id}`);
  const { publicKey } = useWallet();
  const [paymentMethod, setPaymentMethod] =
    useState<RegistrationPaymentMethod>("fiat");
  const [transactionHash, setTransactionHash] = useState<string | null>(null);

  // Restore the saved preference after mount (localStorage is client-only).
  useEffect(() => {
    setPaymentMethod(readStoredPaymentMethod());
  }, []);

  const selectPaymentMethod = (method: RegistrationPaymentMethod) => {
    setPaymentMethod(method);
    try {
      localStorage.setItem(PAYMENT_METHOD_STORAGE_KEY, method);
    } catch {
      // Storage unavailable — preference just won't persist.
    }
  };

  const isPaid = tournament.entryFee > 0;
  const payWithToken = isPaid && paymentMethod === "arenax";
  const { fee, total } = useMemo(
    () => estimateRegistrationFee(tournament.entryFee, paymentMethod),
    [tournament.entryFee, paymentMethod],
  );

  const { data: balances, isLoading: isBalanceLoading } = useQuery({
    queryKey: ["walletBalances", publicKey],
    queryFn: () => fetchWalletBalances(publicKey as string),
    enabled: payWithToken && !!publicKey,
    staleTime: 15_000,
  });
  const tokenBalance = balances?.ARENAX.available ?? 0;
  const walletMissing = payWithToken && !publicKey;
  const insufficientBalance =
    payWithToken && !!balances && tokenBalance < total;
  const cannotPay =
    walletMissing || insufficientBalance || (payWithToken && isBalanceLoading);

  const form = useForm<TournamentRegistrationFormData>({
    resolver: zodResolver(tournamentRegistrationSchema),
    defaultValues: {
      username: "",
      email: "",
      discordHandle: "",
      agreedToRules: false,
    },
  });

  const isSuccess = form.formState.isSubmitSuccessful;

  const onSubmit = async (_data: TournamentRegistrationFormData) => {
    try {
      const result = await api.joinTournament(
        tournament.id,
        isPaid ? paymentMethod : undefined,
      );
      setTransactionHash(result?.transactionHash ?? null);
      analytics.trackSubmit({ success: true });

      notify({
        type: "match",
        title: "Registration Confirmed",
        message: `You're registered for ${tournament.name}. Check your email for details.`,
        link: `/tournaments/${tournament.id}`,
        linkLabel: "View Tournament",
        persistent: true,
        toast: true,
        toastDuration: 6000,
      });

      onSuccess?.();
    } catch (error) {
      analytics.trackSubmit({ success: false });
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Unable to complete registration. Please try again.",
      });
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle className="h-16 w-16 text-success" />
        <h3 className="text-xl font-bold text-foreground">Registration Confirmed</h3>
        <p className="text-muted-foreground">
          You&apos;re registered for{" "}
          <span className="font-semibold">{tournament.name}</span>. We&apos;ll
          notify you when your first match is ready.
        </p>
        <div className="rounded-lg border border-success/30 bg-success-muted p-4 text-sm text-green-800 dark:border-success/30 dark:bg-success-muted/20 dark:text-green-200">
          Tournament starts on{" "}
          <span className="font-semibold">
            {new Date(tournament.startTime).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          . Check in 15 minutes before your first match.
        </div>
        {transactionHash && (
          <p className="text-xs text-muted-foreground">
            Transaction hash:{" "}
            <code className="break-all font-mono text-foreground">
              {transactionHash}
            </code>
          </p>
        )}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
        {/* Tournament summary */}
        <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground">{tournament.name}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Game: {tournament.gameType}</span>
            <span>Format: {tournament.tournamentType.replace(/_/g, " ")}</span>
            <span>
              Entry:{" "}
              <span className="font-medium text-foreground">
                {tournament.entryFee === 0 ? "Free" : `$${tournament.entryFee}`}
              </span>
            </span>
            <span>
              Prize Pool:{" "}
              <span className="font-medium text-foreground">
                ${tournament.prizePool.toLocaleString()}
              </span>
            </span>
          </div>
        </div>

        {/* Username */}
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                In-game Username{" "}
                <span className="text-destructive" aria-hidden="true">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Your in-game name"
                  error={!!form.formState.errors.username}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Email */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Email{" "}
                <span className="text-destructive" aria-hidden="true">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  placeholder="you@example.com"
                  error={!!form.formState.errors.email}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Discord */}
        <FormField
          control={form.control}
          name="discordHandle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Discord Handle{" "}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input {...field} placeholder="username#0000" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Root submission error */}
        {form.formState.errors.root && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-destructive/5 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-destructive/10 dark:text-destructive-foreground"
          >
            <p className="font-semibold">Registration failed</p>
            <p className="mt-1">{form.formState.errors.root.message}</p>
          </div>
        )}

        {/* Rules agreement */}
        <FormField
          control={form.control}
          name="agreedToRules"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3">
                <FormControl>
                  <input
                    type="checkbox"
                    id="agreed-to-rules"
                    checked={field.value}
                    onChange={field.onChange}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-blue-600"
                  />
                </FormControl>
                <label
                  htmlFor="agreed-to-rules"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  I have read and agree to the{" "}
                  <span className="font-medium text-foreground">tournament rules</span>{" "}
                  and understand that entry fees are non-refundable.
                </label>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Payment method + fee estimate */}
        {isPaid && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">
              Payment method
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["fiat", "Card (fiat)"],
                  ["arenax", "ArenaX token"],
                ] as const
              ).map(([method, label]) => (
                <label
                  key={method}
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${
                    paymentMethod === method
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method}
                    checked={paymentMethod === method}
                    onChange={() => selectPaymentMethod(method)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>

            <div
              aria-live="polite"
              className="rounded-lg border border-blue-200 bg-info-muted p-3 text-xs text-info dark:border-info/30 dark:bg-info-muted/20 dark:text-info-muted-foreground"
            >
              <div className="flex justify-between">
                <span>Entry fee</span>
                <span>{payWithToken ? `${tournament.entryFee} ARENAX` : `$${tournament.entryFee.toFixed(2)}`}</span>
              </div>
              <div className="flex justify-between">
                <span>{payWithToken ? "Network fee (est.)" : "Processing fee (est.)"}</span>
                <span>{payWithToken ? `${TOKEN_NETWORK_FEE_XLM} XLM` : `$${fee.toFixed(2)}`}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-info/20 pt-1 font-semibold">
                <span>Total</span>
                <span>{payWithToken ? `${total} ARENAX` : `$${total.toFixed(2)}`}</span>
              </div>
              {payWithToken && balances && (
                <div className="mt-1 flex justify-between">
                  <span>Available balance</span>
                  <span>{tokenBalance} ARENAX</span>
                </div>
              )}
            </div>

            {walletMissing && (
              <p role="alert" className="text-xs text-destructive">
                Connect your wallet to pay with ArenaX tokens.
              </p>
            )}
            {insufficientBalance && (
              <p role="alert" className="text-xs text-destructive">
                Insufficient ArenaX balance. You need {total} ARENAX but have{" "}
                {tokenBalance}. Top up your wallet or pay by card.
              </p>
            )}
          </fieldset>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1"
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || cannotPay}
            className="flex-1 gap-2"
          >
            {form.formState.isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {form.formState.isSubmitting ? "Registering..." : "Confirm Registration"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
