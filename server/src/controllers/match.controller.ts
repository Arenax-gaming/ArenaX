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
        });
        if(!match) return res.status(404).json({error: "Not found"});

        if(match.state !== "ACTIVE")
            return res.status(400).json({error: "Invalid state"});

        const rating = eloService.calculateRating(
            match.player1Elo,
            match.player2Elo,
            winnerId === match.playerId?1:0
        );
        await prisma.match.update({
            where: { id },
            data: {
                state: "SETTLED",
            },
        });
        return res.json({rating});
    }
}