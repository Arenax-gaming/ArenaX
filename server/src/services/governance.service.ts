import { getDatabaseClient } from './database.service';
import { ProposalStatus } from '@prisma/client';

export class GovernanceService {
    /**
     * Create a new multisig proposal in DRAFT state.
     */
    async createProposal(proposerId: string, data: {
        targetContract: string;
        functionName: string;
        args?: any;
        description?: string;
    }) {
        const prisma = getDatabaseClient();
        return await prisma.proposal.create({
            data: {
                ...data,
                proposerId,
                status: ProposalStatus.DRAFT,
            },
        });
    }

    /**
     * Transition a proposal from DRAFT to VOTING.
     */
    async startVoting(proposalId: string) {
        const prisma = getDatabaseClient();
        return await prisma.proposal.update({
            where: { id: proposalId },
            data: { status: ProposalStatus.VOTING },
        });
    }

    /**
     * Vote on an existing proposal.
     * If threshold (e.g., 3 votes) reached, transition to APPROVED.
     */
    async voteOnProposal(proposalId: string, voterId: string, signature?: string) {
        const prisma = getDatabaseClient();
        
        return await prisma.$transaction(async (tx) => {
            // Check if vote already exists
            const existingVote = await tx.vote.findUnique({
                where: {
                    proposalId_voterId: { proposalId, voterId }
                }
            });

            if (existingVote) {
                throw new Error('User has already voted on this proposal');
            }

            // Create the vote
            await tx.vote.create({
                data: {
                    proposalId,
                    voterId,
                    signature,
                },
            });

            // Count votes
            const voteCount = await tx.vote.count({
                where: { proposalId }
            });

            const proposal = await tx.proposal.findUnique({
                where: { id: proposalId }
            });

            if (!proposal) throw new Error('Proposal not found');

            // Simple threshold logic: 3 votes to approve
            // In a real scenario, this would depend on the multisig configuration
            if (voteCount >= 3 && proposal.status === ProposalStatus.VOTING) {
                return await tx.proposal.update({
                    where: { id: proposalId },
                    data: { status: ProposalStatus.APPROVED },
                });
            }

            return proposal;
        });
    }

    /**
     * Execute an APPROVED proposal.
     */
    async executeProposal(proposalId: string) {
        const prisma = getDatabaseClient();
        
        const proposal = await prisma.proposal.findUnique({
            where: { id: proposalId }
        });

        if (!proposal || proposal.status !== ProposalStatus.APPROVED) {
            throw new Error('Proposal must be APPROVED to be executed');
        }

        // TODO: In a real implementation, this would call StellarTxService
        // to invoke the contract on-chain.
        
        return await prisma.proposal.update({
            where: { id: proposalId },
            data: { 
                status: ProposalStatus.EXECUTED,
                executedAt: new Date(),
            },
        });
    }

    /**
     * Get proposal with votes.
     */
    async getProposal(proposalId: string) {
        const prisma = getDatabaseClient();
        return await prisma.proposal.findUnique({
            where: { id: proposalId },
            include: {
                votes: {
                    include: {
                        voter: {
                            select: { username: true, walletAddress: true }
                        }
                    }
                },
                proposer: {
                    select: { username: true }
                }
            }
        });
    }

    /**
     * List all proposals.
     */
    async listProposals() {
        const prisma = getDatabaseClient();
        return await prisma.proposal.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { votes: true }
                }
            }
        });
    }
}
