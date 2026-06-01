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
  username: string;
}

export interface DisputeMatch {
  onChainId: string;
  playerAId: string;
  playerBId: string;
  winnerId: string;
}

export interface Dispute {
  id: string;
  status: string;
  reason: string;
  evidenceUrls: string[];
  reporter: DisputeReporter;
  match: DisputeMatch;
}

export interface GovernanceProposal {
  id: string;
  status: string;
  functionName: string;
  description?: string;
  targetContract: string;
  _count: { votes: number };
}
