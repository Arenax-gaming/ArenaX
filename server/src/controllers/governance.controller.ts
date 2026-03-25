import { Request, Response } from 'express';
import { GovernanceService } from '../services/governance.service';
import { HttpError } from '../utils/http-error';

const governanceService = new GovernanceService();

export const createProposal = async (req: Request, res: Response): Promise<void> => {
    try {
        const proposal = await governanceService.createProposal(req.user!.id, req.body);
        res.status(201).json(proposal);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const startVoting = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const proposal = await governanceService.startVoting(id);
        res.status(200).json(proposal);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};

export const voteOnProposal = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { signature } = req.body;
        const proposal = await governanceService.voteOnProposal(id, req.user!.id, signature);
        res.status(200).json(proposal);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const executeProposal = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const proposal = await governanceService.executeProposal(id);
        res.status(200).json(proposal);
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
};

export const getProposal = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const proposal = await governanceService.getProposal(id);
        if (!proposal) throw new HttpError(404, 'Proposal not found');
        res.status(200).json(proposal);
    } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        res.status(status).json({ error: (error as Error).message });
    }
};

export const listProposals = async (_req: Request, res: Response): Promise<void> => {
    try {
        const proposals = await governanceService.listProposals();
        res.status(200).json(proposals);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};
