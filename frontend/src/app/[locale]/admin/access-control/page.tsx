"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface RoleRecord {
  id: string;
  account: string;
  role: string;
  assignedBy: string;
  date: string;
}

interface DelegationRecord {
  id: string;
  delegator: string;
  delegatee: string;
  role: string;
  expires: string;
  status: "Active" | "Expired";
}

export default function AccessControlDashboard() {
  const [roles, setRoles] = useState<RoleRecord[]>([
    { id: "1", account: "GAdmin123...", role: "Admin", assignedBy: "Genesis", date: "2026-04-01" },
    { id: "2", account: "GGov456...", role: "Governance", assignedBy: "GAdmin123...", date: "2026-04-10" },
    { id: "3", account: "GOperator789...", role: "Operator", assignedBy: "GAdmin123...", date: "2026-04-15" }
  ]);

  const [delegations, setDelegations] = useState<DelegationRecord[]>([
    { id: "1", delegator: "GGov456...", delegatee: "GSub1...", role: "Governance", expires: "2026-07-01", status: "Active" }
  ]);

  const [inputAccount, setInputAccount] = useState("");
  const [selectedRole, setSelectedRole] = useState("Governance");
  const [delegator, setDelegator] = useState("");
  const [delegatee, setDelegatee] = useState("");
  const [duration, setDuration] = useState("3600");

  const handleGrant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputAccount) return;
    setRoles(prev => [
      ...prev,
      {
        id: String(prev.length + 1),
        account: inputAccount,
        role: selectedRole,
        assignedBy: "GAdmin123...",
        date: new Date().toISOString().split("T")[0]
      }
    ]);
    setInputAccount("");
  };

  const handleDelegate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegator || !delegatee) return;
    const expiresDate = new Date(Date.now() + Number(duration) * 1000).toISOString().split("T")[0];
    setDelegations(prev => [
      ...prev,
      {
        id: String(prev.length + 1),
        delegator,
        delegatee,
        role: "Governance",
        expires: expiresDate,
        status: "Active"
      }
    ]);
    setDelegator("");
    setDelegatee("");
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
          🔐 Access Control Registry
        </h1>
        <p className="text-xl text-muted-foreground mt-2">
          Manage roles, configure time-locked permissions, and view authorization audit trails.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Columns - Tables & Audit */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-bold">Active Role Assignments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b text-gray-400 uppercase tracking-wider text-[10px]">
                      <th className="py-2">Account</th>
                      <th className="py-2">Role</th>
                      <th className="py-2">Assigned By</th>
                      <th className="py-2">Date Granted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r) => (
                      <tr key={r.id} className="border-b hover:bg-gray-50/50 dark:hover:bg-gray-800/10">
                        <td className="py-3 font-mono">{r.account}</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300">
                            {r.role}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-gray-500">{r.assignedBy}</td>
                        <td className="py-3 text-gray-500">{r.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Active Delegations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-bold">Time-Locked Permission Delegations</CardTitle>
              <CardDescription>Temporary permissions granted to sub-accounts that automatically expire.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b text-gray-400 uppercase tracking-wider text-[10px]">
                      <th className="py-2">Delegator</th>
                      <th className="py-2">Delegatee</th>
                      <th className="py-2">Role</th>
                      <th className="py-2">Expires At</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {delegations.map((d) => (
                      <tr key={d.id} className="border-b">
                        <td className="py-3 font-mono text-gray-500">{d.delegator}</td>
                        <td className="py-3 font-mono font-semibold">{d.delegatee}</td>
                        <td className="py-3">{d.role}</td>
                        <td className="py-3 text-gray-500">{d.expires}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            d.status === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                          }`}>
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Actions / Management Forms */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Grant New Role</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleGrant} className="space-y-4">
                <div>
                  <label htmlFor="grant-account" className="block text-xs font-bold text-gray-400 uppercase mb-2">Account Address</label>
                  <input
                    id="grant-account"
                    type="text"
                    value={inputAccount}
                    onChange={(e) => setInputAccount(e.target.value)}
                    placeholder="Enter G..."
                    className="w-full px-4 py-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="grant-role" className="block text-xs font-bold text-gray-400 uppercase mb-2">Select Role</label>
                  <select
                    id="grant-role"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="w-full px-4 py-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                  >
                    <option>Admin</option>
                    <option>Governance</option>
                    <option>Operator</option>
                    <option>Whitelist</option>
                  </select>
                </div>
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700">Grant Role</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Delegate Permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDelegate} className="space-y-4">
                <div>
                  <label htmlFor="delegator-account" className="block text-xs font-bold text-gray-400 uppercase mb-2">Delegator Account</label>
                  <input
                    id="delegator-account"
                    type="text"
                    value={delegator}
                    onChange={(e) => setDelegator(e.target.value)}
                    placeholder="Enter G..."
                    className="w-full px-4 py-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="delegatee-account" className="block text-xs font-bold text-gray-400 uppercase mb-2">Delegatee Account</label>
                  <input
                    id="delegatee-account"
                    type="text"
                    value={delegatee}
                    onChange={(e) => setDelegatee(e.target.value)}
                    placeholder="Enter G..."
                    className="w-full px-4 py-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="delegate-duration" className="block text-xs font-bold text-gray-400 uppercase mb-2">Duration (Seconds)</label>
                  <input
                    id="delegate-duration"
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full px-4 py-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700">Delegate Role</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
