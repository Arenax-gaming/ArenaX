"use client";

import React, { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type KycStatus = "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";

interface KycReview {
  id: string;
  userId: string;
  status: KycStatus;
  documents: any[];
  notes?: string;
  user: {
    username: string;
    email: string;
  };
  createdAt: string;
}

export default function KycDashboard() {
  const [reviews, setReviews] = useState<KycReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<KycStatus | "ALL">("ALL");
  const [selectedReview, setSelectedReview] = useState<KycReview | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterStatus !== "ALL" ? { status: filterStatus } : {};
      const data = await api.getKycReviews(params);
      setReviews((data as any).reviews || []);
    } catch (error) {
      console.error("Failed to fetch KYC reviews:", error);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleProcess = async (id: string, status: KycStatus) => {
    if (status === "REJECTED" && !decisionNotes) {
      alert("Please provide a reason for rejection.");
      return;
    }

    setIsSubmitting(true);
    
    // Optimistic Update
    const previousReviews = [...reviews];
    setReviews(reviews.map((r: KycReview) => r.id === id ? { ...r, status } : r));
    if (selectedReview?.id === id) {
      setSelectedReview({ ...selectedReview, status });
    }

    try {
      await api.processKycReview(id, {
        status,
        notes: decisionNotes,
      });
      setDecisionNotes("");
      setSelectedReview(null);
      // Re-fetch to ensure sync
      fetchReviews();
    } catch (error) {
      // Rollback on failure
      setReviews(previousReviews);
      alert("Failed to process KYC review: " + (error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading && reviews.length === 0) {
    return <div className="p-8 text-center text-xl font-medium">Loading KYC reviews...</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
            KYC Review Queue
          </h1>
          <p className="text-xl text-muted-foreground">
            Verify user identities and manage account risk.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm font-medium">Status:</label>
          <select 
            id="status-filter"
            className="bg-background border border-input h-10 px-3 py-2 rounded-md text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={filterStatus}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value as any)}
          >
            <option value="ALL">All Reviews</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ESCALATED">Escalated</option>
          </select>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Review List */}
        <div className="lg:col-span-1 space-y-4 max-h-[calc(100vh-250px)] overflow-y-auto pr-2">
          {reviews.length === 0 ? (
            <Card className="bg-muted/50 border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground text-center">
                <p>No reviews found for this status.</p>
              </CardContent>
            </Card>
          ) : (
            reviews.map((review: KycReview) => (
              <Card 
                key={review.id} 
                className={`cursor-pointer transition-all duration-200 border-2 ${selectedReview?.id === review.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
                onClick={() => setSelectedReview(review)}
              >
                <CardHeader className="p-4 space-y-1">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg truncate">{review.user.username}</CardTitle>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      review.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                      review.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                      review.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {review.status}
                    </span>
                  </div>
                  <CardDescription className="text-xs truncate">{new Date(review.createdAt).toLocaleDateString()}</CardDescription>
                </CardHeader>
              </Card>
            ))
          )}
        </div>

        {/* Detail Pane */}
        <div className="lg:col-span-2">
          {selectedReview ? (
            <Card className="shadow-xl sticky top-6 border-2">
              <CardHeader className="bg-muted/30 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-3xl font-bold">{selectedReview.user.username}</CardTitle>
                    <CardDescription className="text-base">{selectedReview.user.email}</CardDescription>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Review ID</p>
                    <p className="font-mono text-sm">{selectedReview.id.substring(0, 8)}...</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-8 space-y-8">
                <section>
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                    Identity Documents
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {Array.isArray(selectedReview.documents) && selectedReview.documents.length > 0 ? (
                      selectedReview.documents.map((doc: any, i: number) => (
                        <div key={i} className="group relative aspect-video bg-muted rounded-xl overflow-hidden border-2 border-transparent hover:border-primary transition-all">
                          <Image 
                            src={doc.url} 
                            alt={`Document ${i + 1}`} 
                            fill
                            className="object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Button variant="secondary" className="scale-90" onClick={() => window.open(doc.url, '_blank')}>View Original</Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 p-12 bg-muted/30 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground">
                        <p>No documents uploaded for this review.</p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="bg-muted/20 p-6 rounded-2xl border">
                  <h3 className="text-lg font-bold mb-4">Final Decision</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="notes" className="text-sm font-medium mb-1.5 block">Reviewer Notes / Reason</label>
                      <textarea
                        id="notes"
                        rows={3}
                        className="w-full bg-background border border-input rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                        placeholder="Provide reasoning for your decision (required for rejections)..."
                        value={decisionNotes}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDecisionNotes(e.target.value)}
                        disabled={isSubmitting || selectedReview.status !== 'PENDING'}
                      />
                    </div>
                    
                    {selectedReview.status === 'PENDING' ? (
                      <div className="flex flex-wrap gap-3 pt-2">
                        <Button 
                          variant="primary" 
                          className="flex-1 min-w-[140px] bg-green-600 hover:bg-green-700 text-white font-bold"
                          onClick={() => handleProcess(selectedReview.id, "APPROVED")}
                          disabled={isSubmitting}
                        >
                          Approve Identity
                        </Button>
                        <Button 
                          variant="primary" 
                          className="flex-1 min-w-[140px] bg-red-600 hover:bg-red-700 text-white font-bold"
                          onClick={() => handleProcess(selectedReview.id, "REJECTED")}
                          disabled={isSubmitting}
                        >
                          Reject Submission
                        </Button>
                        <Button 
                          variant="secondary" 
                          className="font-bold"
                          onClick={() => handleProcess(selectedReview.id, "ESCALATED")}
                          disabled={isSubmitting}
                        >
                          Escalate to Risk
                        </Button>
                      </div>
                    ) : (
                      <div className={`p-4 rounded-xl border flex items-center justify-between ${
                        selectedReview.status === 'APPROVED' ? 'bg-green-50 border-green-200 text-green-800' :
                        selectedReview.status === 'REJECTED' ? 'bg-red-50 border-red-200 text-red-800' :
                        'bg-gray-50 border-gray-200 text-gray-800'
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className="font-bold uppercase tracking-wider text-xs">Final State: {selectedReview.status}</span>
                        </div>
                        {selectedReview.notes && <p className="text-sm italic">&quot;{selectedReview.notes}&quot;</p>}
                      </div>
                    )}
                  </div>
                </section>
              </CardContent>
            </Card>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-12 bg-muted/20 border-2 border-dashed rounded-3xl text-muted-foreground animate-in fade-in duration-500">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">No Review Selected</h2>
              <p>Select a user from the queue on the left to start the verification process.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
