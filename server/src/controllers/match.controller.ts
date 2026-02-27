import {Request, Response} from "express";
import { PrismaClient } from "@prisma/client";
import {EloService} from "../services/elo.service";

const prisma = new PrismaClient();
const eloService = new EloService();

export class MatchController {
    async reportResult(req: Request, res: Response) {
        const {id} = req.params;
        const { winnerId } = req.body;

        const match = await prisma.match.findUnique({
            where: {id},
            include: {
                player1: true,
                player2: true,
            },
        });
        if(!match) return res.status(404).json({error: "Not found"});

        if(match.state !== "ACTIVE")
            return res.status(400).json({error: "Invalid state"});

        const outcome =
            winnerId === match.player1Id ? 1 :
            winnerId === match.player2Id ? 0 :
            0.5;
        const rating = eloService.calculateRating(
            match.player1.elo,
            match.player2.elo,
            outcome
        );
        await prisma.$transaction([
            prisma.user.update({
                where: { id: match.player1Id},
                data: {
                    elo: rating.newRatingA,
                },
            }),
            prisma.user.update({
                where: { id: match.player2Id},
                data: {
                    elo: rating.newRatingB,
                },
            }),
            prisma.eloHistory.create({
                data: {
                    matchId: match.id,
                    userId: match.player1Id,
                    oldRating: match.player1.elo,
                    newRating: rating.newRatingA,
                    delta: rating.deltaA,
                },
            }),
            prisma.eloHistory.create({
                data: {
                    matchId: match.id,
                    userId: match.player2Id,
                    oldRating: match.player2.elo,
                    newRating: rating.newRatingB,
                    delta: rating.newRatingB,
                },
            }),
            prisma.match.update({
                where: { id},
                data: {
                    state: "SETTLED",
                    winnerId,
                },
            }),
            
        ]);
        return res.json({rating});
    }
}
