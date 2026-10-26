"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startTournamentStream,
  type ConnectionState,
  type TournamentSnapshot,
  type TournamentUpdate,
} from "@/lib/tournament-stream";

export function useTournamentLive(tournamentId: string) {
  const [tournament, setTournament] = useState<TournamentSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [latestResult, setLatestResult] = useState<TournamentUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const control = useRef<ReturnType<typeof startTournamentStream> | null>(null);

  useEffect(() => {
    setTournament(null);
    setLatestResult(null);
    setError(null);
    setLoading(true);
    const current = startTournamentStream({
      tournamentId,
      apiBase: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api",
      onSnapshot(snapshot) {
        setTournament(snapshot);
        setLoading(false);
        setError(null);
      },
      onError(message) {
        setError(message);
        setLoading(false);
      },
      onConnection: setConnection,
      onMatchResult: setLatestResult,
    });
    control.current = current;
    return () => {
      current.stop();
      if (control.current === current) control.current = null;
    };
  }, [tournamentId]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    void control.current?.refresh();
  }, []);

  const changingRoute = tournament !== null && tournament.id !== tournamentId;
  return {
    tournament: changingRoute ? null : tournament,
    connection,
    latestResult: latestResult?.tournament_id === tournamentId ? latestResult : null,
    error: changingRoute ? null : error,
    loading: loading || changingRoute,
    retry,
  };
}
