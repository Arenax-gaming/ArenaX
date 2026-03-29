import { Request, Response, NextFunction } from 'express';
import { sorobanService } from '../services/soroban.service';
import { HttpError } from '../utils/http-error';

export const simulateContract = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { contractId, functionName, args, sponsored } = req.body;
        if (!contractId || !functionName) throw new HttpError(400, 'contractId and functionName are required');
        const result = await sorobanService.simulate({
            contractId, functionName, args, sponsored,
            userId: req.user?.id,
        });
        res.json(result);
    } catch (err) { next(err); }
};

export const invokeContract = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { contractId, functionName, args, sponsored, type } = req.body;
        if (!contractId || !functionName) throw new HttpError(400, 'contractId and functionName are required');
        const result = await sorobanService.invokeContract({
            contractId, functionName, args, sponsored, type,
            userId: req.user?.id,
        });
        res.status(202).json(result);
    } catch (err) { next(err); }
};

export const getTxStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { txHash } = req.params;
        const record = await sorobanService.getTransactionStatus(txHash);
        if (!record) throw new HttpError(404, 'Transaction not found');
        res.json(record);
    } catch (err) { next(err); }
};
