"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { User } from "@/types/user";

type UserWithStatus = User & { banned?: boolean };

export default function UserManagement() {
  const [users, setUsers] = useState<UserWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      const data = await api.getAuditLogs(params);
      // The admin users endpoint may not exist yet — fall back gracefully
      // Try a dedicated users endpoint first, then fall back to empty
      setUsers((data as any)?.users ?? (Array.isArray(data) ? data : []));
    } catch {
      // If the endpoint doesn't exist, show empty state rather than crashing
      setUsers([]);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  // Fetch users from the admin users endpoint
  const fetchUsersFromEndpoint = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryString = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : "";
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token")
          : null;
      const res = await fetch(`/api/admin/users${queryString}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setUsers(json?.users ?? json?.data ?? (Array.isArray(json) ? json : []));
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchUsersFromEndpoint();
  }, [fetchUsersFromEndpoint]);

  const handleBanToggle = async (user: UserWithStatus) => {
    setActionLoading(user.id);
    try {
      const action = user.banned ? "unban" : "ban";
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token")
          : null;
      const res = await fetch(`/api/admin/users/${user.id}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistic update
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, banned: !u.banned } : u))
      );
    } catch (err) {
      setError(`Failed to ${user.banned ? "unban" : "ban"} user: ${(err as Error).message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const roleColor = (role?: string) => {
    if (role === "admin") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    if (role === "moderator") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  };

  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
              User Management
            </h1>
            <p className="text-xl text-muted-foreground mt-1">
              Search, view, ban and unban platform users.
            </p>
          </div>
        </header>

        {/* Search */}
        <div className="flex gap-3 max-w-lg">
          <Input
            placeholder="Search by username or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
            aria-label="Search users"
          />
          {search && (
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Clear
            </Button>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* User table */}
        {loading ? (
          <div className="p-8 text-center text-xl font-medium text-muted-foreground">
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <Card className="bg-muted/50 border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <p>{debouncedSearch ? `No users found for "${debouncedSearch}".` : "No users found."}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">User</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Email</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Role</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">ELO</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Joined</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {user.username?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <span className="font-medium truncate max-w-[120px]">{user.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[160px]">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${roleColor(user.role)}`}>
                        {user.role ?? "user"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{user.elo ?? "—"}</td>
                    <td className="px-4 py-3">
                      {user.banned ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                          Banned
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={user.banned ? "primary" : "secondary"}
                        size="sm"
                        className={user.banned ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
                        onClick={() => handleBanToggle(user)}
                        loading={actionLoading === user.id}
                        disabled={actionLoading !== null}
                      >
                        {user.banned ? "Unban" : "Ban"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
