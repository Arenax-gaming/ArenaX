"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function GovernanceDashboard() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProposals();
  }, []);

  const fetchProposals = async () => {
    try {
      const data = await api.getProposals();
      setProposals(data);
    } catch (error) {
      console.error("Failed to fetch proposals:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartVoting = async (id: string) => {
    await api.startVoting(id);
    fetchProposals();
  };

  const handleVote = async (id: string) => {
    await api.voteOnProposal(id);
    fetchProposals();
  };

  const handleExecute = async (id: string) => {
    await api.executeProposal(id);
    fetchProposals();
  };

  if (loading) return <div className="p-8 text-center text-xl font-medium">Loading proposals...</div>;

  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
            Governance
          </h1>
          <p className="text-xl text-muted-foreground mt-2">
            Multisig proposal management and platform updates.
          </p>
        </div>
        <Button size="lg" className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 border-none shadow-lg">
          Create Proposal
        </Button>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        {proposals.length === 0 ? (
           <div className="col-span-full py-20 text-center text-muted-foreground border-2 border-dashed rounded-xl">
             No proposals found.
           </div>
        ) : (
          proposals.map((proposal) => (
            <Card key={proposal.id} className="group border-2 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all duration-300 shadow-sm hover:shadow-xl">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-widest mb-2">
                    {proposal.status}
                  </div>
                  <div className="text-sm font-mono text-muted-foreground">
                    #{proposal.id.substring(0, 8)}
                  </div>
                </div>
                <CardTitle className="text-2xl font-bold group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {proposal.functionName}
                </CardTitle>
                <CardDescription className="text-md line-clamp-2 mt-2">
                  {proposal.description || "No description provided."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Target Contract</p>
                    <p className="text-sm font-mono truncate text-gray-700 dark:text-gray-300">{proposal.targetContract}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex -space-x-2 overflow-hidden">
                      {[...Array(proposal._count.votes)].map((_, i) => (
                        <div key={i} className="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-gray-900 bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">
                          ✓
                        </div>
                      ))}
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {proposal._count.votes} / 3 signatures
                    </p>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500" 
                      style={{ width: `${Math.min((proposal._count.votes / 3) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                <div className="w-full flex gap-2">
                  {proposal.status === "DRAFT" && (
                    <Button className="w-full" variant="primary" onClick={() => handleStartVoting(proposal.id)}>
                      Begin Voting
                    </Button>
                  )}
                  {proposal.status === "VOTING" && (
                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleVote(proposal.id)}>
                      Sign Proposal
                    </Button>
                  )}
                  {proposal.status === "APPROVED" && (
                    <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => handleExecute(proposal.id)}>
                      Execute On-Chain
                    </Button>
                  )}
                  {proposal.status === "EXECUTED" && (
                    <Button className="w-full" variant="outline" disabled>
                      Executed
                    </Button>
                  )}
                </div>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
