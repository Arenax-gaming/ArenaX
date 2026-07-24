"use client";

import { useForm } from "react-hook-form";
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
      await api.joinTournament(tournament.id);
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

        {/* Entry fee notice */}
        {tournament.entryFee > 0 && (
          <div className="rounded-lg border border-blue-200 bg-info-muted p-3 dark:border-info/30 dark:bg-info-muted/20">
            <p className="text-xs text-info dark:text-info-muted-foreground">
              <span className="font-semibold">Payment:</span> Your wallet will be
              charged{" "}
              <span className="font-semibold">${tournament.entryFee}</span> upon
              confirmation.
            </p>
          </div>
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
            disabled={form.formState.isSubmitting}
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
