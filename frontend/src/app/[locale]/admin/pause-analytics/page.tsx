"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface ContractStatus {
  id: string;
  name: string;
  address: string;
  status: "Operational" | "Paused" | "Partially Paused";
  lastAction: string;
}

export default function PauseAnalyticsDashboard() {
  const [contracts, setContracts] = useState<ContractStatus[]>([
    { id: "1", name: "MatchContract", address: "CCmatch...", status: "Operational", lastAction: "Active since epoch" },
    { id: "2", name: "StakingRewards", address: "CCstake...", status: "Operational", lastAction: "Active since epoch" },
    { id: "3", name: "TournamentManager", address: "CCtourn...", status: "Operational", lastAction: "Active since epoch" }
  ]);
  const [logs, setLogs] = useState<any[]>([
    { id: "1", type: "PAUSE", target: "StakingRewards", admin: "GAdmin...", reason: "WASM simulation checks", date: "2026-06-15" }
  ]);
  const [reason, setReason] = useState("");

  const handlePauseToggle = (id: string) => {
    setContracts(prev => prev.map(c => {
      if (c.id === id) {
        const nextStatus = c.status === "Operational" ? "Paused" : "Operational";
        // Append log
        setLogs(prevLogs => [
          {
            id: String(prevLogs.length + 1),
            type: nextStatus === "Paused" ? "PAUSE" : "UNPAUSE",
            target: c.name,
            admin: "GAdmin...",
            reason: reason || "Standard action",
            date: new Date().toISOString().split("T")[0]
          },
          ...prevLogs
        ]);
        return {
          ...c,
          status: nextStatus,
          lastAction: nextStatus === "Paused" ? "Paused by Admin" : "Resumed operations"
        };
      }
      return c;
    }));
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
            🚨 Emergency Pause Controls
          </h1>
          <p className="text-xl text-muted-foreground mt-2">
            Freeze smart contract operations immediately in response to security incidents.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 border-none shadow-lg">
            PAUSE ALL CONTRACTS
          </Button>
        </div>
      </header>

      {/* Inputs for reason */}
      <div className="bg-gray-50 dark:bg-gray-800/40 p-4 rounded-xl border flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex-1 w-full">
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Incident Reason/Note</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe the incident details (e.g. Exploit validation checks)"
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Columns - Contracts Grid */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {contracts.map((c) => (
              <Card key={c.id} className="border-2 hover:border-red-400 transition-all duration-300">
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      c.status === "Operational" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}>
                      {c.status}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">{c.address}</span>
                  </div>
                  <CardTitle className="text-2xl font-bold mt-2">{c.name}</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-1">
                    {c.lastAction}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Function Overrides</span>
                      <span className="font-semibold text-green-600">Active</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Multisig Quorum</span>
                      <span className="font-semibold">2 / 3 required</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    className={`w-full font-semibold ${
                      c.status === "Operational" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
                    }`}
                    onClick={() => handlePauseToggle(c.id)}
                  >
                    {c.status === "Operational" ? "Freeze Operations" : "Resume Operations"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          {/* Incident Audit Log */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Pause Log & Audit Trail</CardTitle>
              <CardDescription>Historical ledger of all pause and unpause calls.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs md:text-sm">
                  <thead>
                    <tr className="border-b text-gray-400 uppercase tracking-widest text-[10px]">
                      <th className="py-2">Type</th>
                      <th className="py-2">Contract</th>
                      <th className="py-2">Admin Address</th>
                      <th className="py-2">Reason</th>
                      <th className="py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b">
                        <td className="py-3 font-semibold">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            log.type === "PAUSE" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
                          }`}>
                            {log.type}
                          </span>
                        </td>
                        <td className="py-3 font-medium">{log.target}</td>
                        <td className="py-3 font-mono text-gray-500">{log.admin}</td>
                        <td className="py-3 text-muted-foreground">{log.reason}</td>
                        <td className="py-3 text-gray-500">{log.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Status Overview */}
        <div className="space-y-6">
          <Card className="border-2 border-red-100 dark:border-red-950">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-red-700 dark:text-red-400">Emergency Protocol</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-150 rounded-lg">
                <h4 className="font-bold mb-1">Quick Action (M-of-N)</h4>
                <p className="text-xs text-muted-foreground">
                  The active pause contract allows immediate trigger of contract freezing via a single authorized multisig signer or designated security validator.
                </p>
              </div>
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-150 rounded-lg">
                <h4 className="font-bold mb-1">Unpausing Controls</h4>
                <p className="text-xs text-muted-foreground">
                  Resuming contract activity is highly secure and requires a complete execution block via Governance multi-sig, validating that the underlying bug or vulnerability has been fixed.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Notifications Integrations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex justify-between items-center border-b pb-2">
                <span>Webhook Webhook Trigger</span>
                <span className="text-green-600 font-bold">Enabled</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span>Admin Alert Email/SMS</span>
                <span className="text-green-600 font-bold">Enabled</span>
              </div>
              <div className="flex justify-between items-center pb-1">
                <span>Stellar Ledger Event logs</span>
                <span className="text-green-600 font-bold">Active</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
