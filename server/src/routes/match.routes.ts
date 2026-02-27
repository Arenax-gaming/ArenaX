import {Router} from "express";
import {MatchController} from "../controllers/match.controller";

const router = Router();
const controller = new MatchController();

router.post("/matches/:id/report",(req, res) =>
    controller.reportResult(req, res)
);
export default router;