export type KycStatus = "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";

export interface KycDocument {
  url: string;
  type?: string;
}

export interface KycReviewUser {
  username: string;
  email: string;
}

export interface KycReview {
  id: string;
  userId: string;
  status: KycStatus;
  documents: KycDocument[];
  notes?: string;
  user: KycReviewUser;
  createdAt: string;
}

export interface DisputeReporter {
  id?: string;
  username: string;
}

export interface DisputeScoreReport {
  playerId: string;
  username: string;
  reportedScore: number;
  reportedAt: string;
}

export interface DisputeMatch {
  id?: string;
  onChainId: string;
  playerAId: string;
  playerBId: string;
  playerAUsername?: string;
  playerBUsername?: string;
  winnerId: string;
  gameType?: string;
  scoreReports?: DisputeScoreReport[];
  createdAt?: string;
}

export interface Dispute {
  id: string;
  status: string;
  reason: string;
  evidenceUrls: string[];
  reporter: DisputeReporter;
  match: DisputeMatch;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResolveDisputePayload {
  status: "RESOLVED" | "DISMISSED" | "VOIDED";
  resolution: string;
  winnerOverrideId?: string;
}

export interface GovernanceProposal {
  id: string;
  status: string;
  functionName: string;
  description?: string;
  targetContract: string;
  _count: { votes: number };
}
