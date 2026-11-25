"use client";

/**
 * MatchInvitePageClient — issue #1562.
 *
 * Resolves a `/match/invite/:token` deep link and renders the invite card
 * (opponent, game type, entry fee) with accept/decline actions. Accepting
 * submits the response and navigates to the match lobby. An expired or
 * invalid token shows a clear, specific error instead of a generic failure.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, Swords, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";
import type { MatchInvite } from "@/types/match";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; invite: MatchInvite }
  | { phase: "error"; message: string };

function errorMessageFor(err: unknown): string {
  if (err instanceof Error) {
    if (/404|not.?found/i.test(err.message)) {
      return "This invite link is invalid. Double-check the link and try again.";
    }
    if (/expired|410/i.test(err.message)) {
      return "This match invite has expired.";
    }
    return err.message;
  }
  return "Unable to load this match invite.";
}

export function MatchInvitePageClient() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { notify } = useNotifications();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [responding, setResponding] = useState(false);

  const loadInvite = useCallback(async () => {
    if (!token) {
      setState({ phase: "error", message: "Missing invite token." });
      return;
    }
    setState({ phase: "loading" });
    try {
      const invite = await api.getMatchInvite(token);
      if (invite.status === "expired") {
        setState({ phase: "error", message: "This match invite has expired." });
        return;
      }
      if (invite.status === "invalid") {
        setState({
          phase: "error",
          message: "This invite link is invalid. Double-check the link and try again.",
        });
        return;
      }
      setState({ phase: "ready", invite });
    } catch (err) {
      setState({ phase: "error", message: errorMessageFor(err) });
    }
  }, [token]);

  useEffect(() => {
    // Middleware already redirects unauthenticated requests to
    // /login?returnTo=... before this component ever mounts, but we still
    // wait for the client-side auth probe to settle before fetching so we
    // don't fire a request we know will 401.
    if (authLoading) return;
    if (!user) return;
    loadInvite();
  }, [authLoading, user, loadInvite]);

  const respond = async (response: "accept" | "decline") => {
    if (state.phase !== "ready" || !token) return;
    setResponding(true);
    try {
      const result = await api.respondToMatchInvite(token, response);
      if (response === "accept") {
        notify({
          type: "match",
          title: "Invite accepted",
          message: `You're in! Heading to the match lobby.`,
          toast: true,
          toastDuration: 4000,
        });
        router.push(`/matches/${result.matchId}`);
      } else {
        notify({
          type: "match",
          title: "Invite declined",
          message: "You declined the match invite.",
          toast: true,
          toastDuration: 4000,
        });
        router.push("/dashboard");
      }
    } catch (err) {
      notify({
        type: "match",
        title: "Something went wrong",
        message: err instanceof Error ? err.message : "Unable to respond to this invite.",
        toast: true,
        toastDuration: 6000,
      });
    } finally {
      setResponding(false);
    }
  };

  if (authLoading || (user && state.phase === "loading")) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!user) {
    // Belt-and-suspenders: middleware should already have redirected.
    return null;
  }

  if (state.phase === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <XCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
            <CardTitle>Invite Unavailable</CardTitle>
            <CardDescription role="alert">{state.message}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state.phase !== "ready") {
    return null;
  }

  const { invite } = state;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Swords className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Match Invite</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{invite.opponent.username}</span>{" "}
            challenged you to a match
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary"
              aria-hidden="true"
            >
              {invite.opponent.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                {invite.opponent.username}
              </p>
              {typeof invite.opponent.elo === "number" && (
                <p className="text-xs text-muted-foreground">{invite.opponent.elo} ELO</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Game</p>
              <p className="font-medium text-foreground">{invite.gameType}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Trophy className="h-3 w-3" aria-hidden="true" /> Entry Fee
              </p>
              <p className="font-medium text-foreground">
                {invite.entryFee === 0 ? "Free" : `$${invite.entryFee}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-info-muted p-3 text-xs text-info dark:border-info/30 dark:bg-info-muted/20 dark:text-info-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Expires {new Date(invite.expiresAt).toLocaleString()}
          </div>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            disabled={responding}
            onClick={() => respond("decline")}
          >
            Decline
          </Button>
          <Button
            className="flex-1 gap-2"
            disabled={responding}
            onClick={() => respond("accept")}
          >
            {responding && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Accept
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
