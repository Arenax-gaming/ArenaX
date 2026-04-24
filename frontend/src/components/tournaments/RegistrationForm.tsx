"use client";

import React, { useState } from "react";
import { Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";

interface RegistrationFormProps {
  tournament: Tournament;
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface FormState {
  username: string;
  email: string;
  discordHandle: string;
  agreedToRules: boolean;
}

export function RegistrationForm({ tournament, onSuccess, onCancel }: RegistrationFormProps) {
  const { notify } = useNotifications();
  const [form, setForm] = useState<FormState>({
    username: "",
    email: "",
    discordHandle: "",
    agreedToRules: false,
  });
  const [errors, setErrors] = useState<Partial<FormState & { submit: string }>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.username.trim()) next.username = "Username is required";
    if (!form.email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Invalid email";
    if (!form.agreedToRules) next.agreedToRules = false;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setStatus("submitting");
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1500));
    setStatus("success");

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
  };

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle className="h-16 w-16 text-green-500" />
        <h3 className="text-xl font-bold text-foreground">Registration Confirmed</h3>
        <p className="text-muted-foreground">
          You&apos;re registered for <span className="font-semibold">{tournament.name}</span>.
          We&apos;ll notify you when your first match is ready.
        </p>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/20 dark:text-green-200">
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
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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
            <span className="font-medium text-foreground">${tournament.prizePool.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="reg-username" className="text-sm font-medium text-foreground">
            In-game Username <span className="text-red-500">*</span>
          </label>
          <Input
            id="reg-username"
            placeholder="Your in-game name"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            aria-invalid={!!errors.username}
          />
          {errors.username && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" /> {errors.username}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="reg-email" className="text-sm font-medium text-foreground">
            Email <span className="text-red-500">*</span>
          </label>
          <Input
            id="reg-email"
            type="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            aria-invalid={!!errors.email}
          />
          {errors.email && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" /> {errors.email}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="reg-discord" className="text-sm font-medium text-foreground">
            Discord Handle <span className="text-muted-foreground text-xs">(optional)</span>
          </label>
          <Input
            id="reg-discord"
            placeholder="username#0000"
            value={form.discordHandle}
            onChange={(e) => setForm((f) => ({ ...f, discordHandle: e.target.value }))}
          />
        </div>
      </div>

      {/* Rules agreement */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-blue-600"
          checked={form.agreedToRules}
          onChange={(e) => setForm((f) => ({ ...f, agreedToRules: e.target.checked }))}
        />
        <span className="text-sm text-muted-foreground">
          I have read and agree to the{" "}
          <span className="font-medium text-foreground">tournament rules</span> and understand
          that entry fees are non-refundable.
        </span>
      </label>
      {errors.agreedToRules === false && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" /> You must agree to the rules
        </p>
      )}

      {/* Entry fee notice */}
      {tournament.entryFee > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            <span className="font-semibold">Payment:</span> Your wallet will be charged{" "}
            <span className="font-semibold">${tournament.entryFee}</span> upon confirmation.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={status === "submitting"}
          className="flex-1 gap-2"
        >
          {status === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}
          {status === "submitting" ? "Registering..." : "Confirm Registration"}
        </Button>
      </div>
    </form>
  );
}
