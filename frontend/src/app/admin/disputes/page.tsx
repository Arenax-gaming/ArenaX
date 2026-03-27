"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function DisputeDashboard() {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDisputes();
  }, []);

  const fetchDisputes = async () => {
    try {
      const data = await api.getDisputes();
      setDisputes(data as any[]);
    } catch (error) {
      console.error("Failed to fetch disputes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (id: string, status: "RESOLVED" | "DISMISSED", winnerOverrideId?: string) => {
    try {
      await api.resolveDispute(id, {
        status,
        resolution: status === "RESOLVED" ? "Admin override applied" : "Dispute dismissed",
        winnerOverrideId,
      });
      fetchDisputes(); // Refresh list
    } catch (error) {
      alert("Failed to resolve dispute: " + (error as Error).message);
    }
  };

  if (loading) return <div className="p-8 text-center text-xl font-medium">Loading disputes...</div>;

  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
          Dispute Resolution
        </h1>
        <p className="text-xl text-muted-foreground">
          Review evidence and resolve match disputes fairly.
        </p>
      </header>

      <div className="grid gap-6">
        {disputes.length === 0 ? (
          <Card className="bg-muted/50 border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <p>No open disputes at this time.</p>
            </CardContent>
          </Card>
        ) : (
          disputes.map((dispute) => (
            <Card key={dispute.id} className="overflow-hidden border-2 border-indigo-100 dark:border-indigo-900 shadow-lg hover:shadow-xl transition-shadow duration-300">
              <CardHeader className="bg-indigo-50/50 dark:bg-indigo-950/20">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl text-indigo-900 dark:text-indigo-100">
                      Match: {dispute.match.onChainId.substring(0, 10)}...
                    </CardTitle>
                    <CardDescription className="font-medium text-indigo-600 dark:text-indigo-400">
                      Reported by {dispute.reporter.username}
                    </CardDescription>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold uppercase tracking-wider">
                    {dispute.status}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-1">Reason</h4>
                      <p className="text-lg text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-100 dark:border-gray-700">
                        {dispute.reason}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-2">Evidence</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {dispute.evidenceUrls.map((url: string, index: number) => (
                          <div key={index} className="aspect-square bg-gray-200 rounded-md overflow-hidden border">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Evidence ${index + 1}`} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col justify-between border-l pl-8 border-indigo-50 dark:border-indigo-900">
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Match Details</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                          <p className="text-xs text-red-600 font-bold uppercase">Player A</p>
                          <p className="text-sm font-mono truncate">{dispute.match.playerAId}</p>
                        </div>
                        <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                          <p className="text-xs text-blue-600 font-bold uppercase">Player B</p>
                          <p className="text-sm font-mono truncate">{dispute.match.playerBId}</p>
                        </div>
                      </div>
                      <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-100 dark:border-green-900/50">
                        <p className="text-xs text-green-600 font-bold uppercase">Reported Winner</p>
                        <p className="text-lg font-bold">{dispute.match.winnerId === dispute.match.playerAId ? "Player A" : "Player B"}</p>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-6">
                      <Button variant="secondary" onClick={() => handleResolve(dispute.id, "DISMISSED")}>
                        Dismiss Dispute
                      </Button>
                      <Button variant="primary" className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => handleResolve(dispute.id, "RESOLVED", dispute.match.playerAId)}>
                        Override Winner (Player A)
                      </Button>
                      <Button variant="primary" className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => handleResolve(dispute.id, "RESOLVED", dispute.match.playerBId)}>
                        Override Winner (Player B)
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
