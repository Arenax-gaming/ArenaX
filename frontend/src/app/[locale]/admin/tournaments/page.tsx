"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tournament, TournamentStatus } from "@/types/tournament";
import { formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<TournamentStatus, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  registration_open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  registration_closed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function TournamentManagement() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<TournamentStatus | "all">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchTournaments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filterStatus !== "all") params.status = filterStatus;
      if (search) params.search = search;
      const data = await api.getTournaments(params);
      setTournaments(
        (data as any)?.tournaments ?? (data as any)?.data ?? (Array.isArray(data) ? data : [])
      );
    } catch {
      setTournaments([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  useEffect(() => {
    const timer = setTimeout(fetchTournaments, 300);
    return () => clearTimeout(timer);
  }, [fetchTournaments]);

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this tournament? This cannot be undone.")) return;
    setActionLoading(id);
    setError(null);
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token")
          : null;
      const res = await fetch(`/api/tournaments/${id}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTournaments((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "cancelled" as TournamentStatus } : t))
      );
    } catch (err) {
      setError(`Failed to cancel tournament: ${(err as Error).message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const canCancel = (status: TournamentStatus) =>
    ["draft", "registration_open", "registration_closed"].includes(status);

  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
              Tournament Management
            </h1>
            <p className="text-xl text-muted-foreground mt-1">
              List, create and cancel tournaments.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 border-none shadow-lg"
            onClick={() => setShowCreateModal(true)}
          >
            + Create Tournament
          </Button>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Search tournaments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
            aria-label="Search tournaments"
          />
          <div className="flex items-center gap-2">
            <label htmlFor="status-filter" className="text-sm font-medium text-muted-foreground">Status:</label>
            <select
              id="status-filter"
              className="bg-background border border-input h-10 px-3 py-2 rounded-md text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as TournamentStatus | "all")}
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="registration_open">Registration Open</option>
              <option value="registration_closed">Registration Closed</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Create modal placeholder */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <Card className="w-full max-w-md shadow-2xl border-2">
              <CardHeader>
                <CardTitle>Create Tournament</CardTitle>
                <CardDescription>Fill in the details to create a new tournament.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Tournament creation form — connect to <code className="bg-muted px-1 rounded">POST /api/tournaments</code> to implement.
                </p>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setShowCreateModal(false)}>Create</Button>
              </CardFooter>
            </Card>
          </div>
        )}

        {/* Tournament list */}
        {loading ? (
          <div className="p-8 text-center text-xl font-medium text-muted-foreground">
            Loading tournaments…
          </div>
        ) : tournaments.length === 0 ? (
          <Card className="bg-muted/50 border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <p>{search || filterStatus !== "all" ? "No tournaments match your filters." : "No tournaments found."}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {tournaments.map((tournament) => (
              <Card key={tournament.id} className="border-2 hover:shadow-lg transition-shadow duration-200">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-tight">{tournament.name}</CardTitle>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${STATUS_COLORS[tournament.status]}`}>
                      {tournament.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <CardDescription className="text-xs font-mono text-muted-foreground">
                    #{tournament.id.substring(0, 8)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-muted/40 rounded">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Game</p>
                      <p className="font-medium truncate">{tournament.gameType}</p>
                    </div>
                    <div className="p-2 bg-muted/40 rounded">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Type</p>
                      <p className="font-medium truncate">{tournament.tournamentType?.replace(/_/g, " ")}</p>
                    </div>
                    <div className="p-2 bg-muted/40 rounded">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Prize Pool</p>
                      <p className="font-medium">${tournament.prizePool?.toLocaleString() ?? "—"}</p>
                    </div>
                    <div className="p-2 bg-muted/40 rounded">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Players</p>
                      <p className="font-medium">{tournament.currentParticipants ?? 0} / {tournament.maxParticipants}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Starts: {tournament.startTime ? formatDate(tournament.startTime) : "—"}
                  </p>
                </CardContent>
                <CardFooter className="pt-0">
                  {canCancel(tournament.status) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => handleCancel(tournament.id)}
                      loading={actionLoading === tournament.id}
                      disabled={actionLoading !== null}
                    >
                      Cancel Tournament
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full" disabled>
                      {tournament.status === "cancelled" ? "Cancelled" : "No Actions Available"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
